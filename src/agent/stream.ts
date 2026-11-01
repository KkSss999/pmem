import type { PluginCallContext } from '@miao/agent/contracts';
import type { HarnessAssemblyContribution, HarnessCatalogDocument } from '@miao/agent/harness';
import type { CompiledExtension } from '@miao/agent/plugins';
import type { OwnedDatabase } from '../db/database';
import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryAccess } from '../domain/memory/types';
import type { MemoryStreamRepository } from '../db/memory/stream-repository';
import type { MemoryStreamSessionRepository } from '../db/memory/stream-session-repository';
import { assembleMemoryStream } from '../server/stream';
import { createSingleUserAgentHost, PMEM_AGENT_WORKSPACE_ID } from './access';
import type { PmemAgentHost } from './contracts';
import { loadMiao, loadTypebox } from './miao';
import { PmemAgentRuntime, type PmemAgentRuntimeOptions } from './runtime';

export const MEMORY_STREAM_ROLE = 'memory-stream';

export interface PreparedStreamItem {
  envelope: unknown;
  apply(payload: unknown): void;
}

export interface MemoryStreamHandler {
  prepare(item: MemoryStreamItem): PreparedStreamItem | Promise<PreparedStreamItem>;
}

interface ActiveItem {
  item: MemoryStreamItem;
  prepared: PreparedStreamItem;
}

const HARNESS: HarnessCatalogDocument = {
  schemaVersion: 1,
  instructions: [
    {
      id: 'memory-stream',
      description: 'Process one memory queue item at a time',
      text: [
        'Process exactly one supplied memory queue item.',
        'Use only IDs and evidence in the item envelope; do not invent facts or IDs.',
        'For L1 extraction, sourceIds must exactly match supplied message IDs and relatedSpaceIds must be empty unless a related space is explicitly supplied; never use the owner space.',
        'Submit the result by calling memory_stream_submit exactly once.',
        'Keep the source language and preserve uncertainty, dates, numbers and context.',
        'This is a background task: do not answer in prose. You must call memory_stream_submit; a text-only response is invalid.',
      ].join(' '),
      source: 'pmem/agent/memory-stream',
      requiresTools: ['memory_stream_submit'],
      dependsOn: [],
    },
  ],
  profiles: [
    {
      id: 'memory-stream',
      role: MEMORY_STREAM_ROLE,
      version: 1,
      source: 'pmem/agent/memory-stream',
      instructions: ['memory-stream'],
      contexts: [],
      skills: [],
    },
  ],
};

const ASSEMBLY: HarnessAssemblyContribution = {
  identityRole: () => MEMORY_STREAM_ROLE,
};

/** Keep a stream envelope within MiaoTs' durable input limit. */
export function fitStreamEnvelope(value: unknown, maxChars = 10_000): unknown {
  const measure = (candidate: unknown) => JSON.stringify(candidate).length;
  if (measure(value) <= maxChars) return value;
  const trim = (node: unknown, textLimit: number, arrayLimit: number): unknown => {
    if (typeof node === 'string')
      return node.length <= textLimit ? node : `${node.slice(0, textLimit)}…`;
    if (Array.isArray(node))
      return node.slice(0, arrayLimit).map((item) => trim(item, textLimit, arrayLimit));
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, item]) => [
        key,
        trim(item, textLimit, arrayLimit),
      ])
    );
  };
  for (const [textLimit, arrayLimit] of [
    [4_000, 20],
    [2_000, 10],
    [1_000, 6],
    [500, 4],
    [200, 2],
  ] as const) {
    const candidate = trim(value, textLimit, arrayLimit);
    if (measure(candidate) <= maxChars) return candidate;
  }
  return trim(value, 80, 1);
}
function bindingOf(context: PluginCallContext) {
  return { workspaceId: context.binding.workspaceId, sessionId: context.binding.sessionId };
}

async function createStreamPlugin(
  state: { current?: ActiveItem },
  queue: MemoryStreamRepository
): Promise<CompiledExtension> {
  const [{ createExtension }, { Type }] = await Promise.all([loadMiao(), loadTypebox()]).then(
    ([miao, typebox]) => [miao.plugins, typebox] as const
  );
  return createExtension({ id: 'pmem.memory.stream', version: '1.0.0' }, (api) => {
    api.registerTool({
      name: 'memory_stream_submit',
      description:
        'Submit the result for the current memory queue item. Use only supplied IDs. This is a background task: call this exactly once and do not answer in prose.',
      parameters: Type.Object({
        kind: Type.Union([
          Type.Literal('l1-extract'),
          Type.Literal('l1-maintenance'),
          Type.Literal('l2-synthesize'),
          Type.Literal('l3-keywords'),
        ]),
        memories: Type.Optional(
          Type.Array(
            Type.Object({
              content: Type.String({ minLength: 1 }),
              abstraction: Type.String({ minLength: 1 }),
              cues: Type.Array(Type.String({ minLength: 1 })),
              sourceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
              relatedSpaceIds: Type.Array(Type.String({ minLength: 1 })),
            })
          )
        ),
        decisions: Type.Optional(
          Type.Array(
            Type.Object({
              memoryId: Type.String({ minLength: 1 }),
              action: Type.Union([
                Type.Literal('keep'),
                Type.Literal('uncertain'),
                Type.Literal('merge'),
              ]),
              targetId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
              content: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
              abstraction: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
              cues: Type.Array(Type.String({ minLength: 1 })),
            })
          )
        ),
        results: Type.Optional(
          Type.Array(
            Type.Object({
              action: Type.Union([Type.Literal('create'), Type.Literal('update')]),
              l2Id: Type.Optional(Type.String({ minLength: 1 })),
              supersede: Type.Optional(Type.Boolean()),
              title: Type.String({ minLength: 1 }),
              summary: Type.String({ minLength: 1 }),
              body: Type.String({ minLength: 1 }),
              l1Ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
            })
          )
        ),
        uncoveredL1Ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        keywords: Type.Optional(
          Type.Array(
            Type.Object({
              term: Type.String({ minLength: 1 }),
              aliases: Type.Array(Type.String({ minLength: 1 })),
              kind: Type.Union([
                Type.Literal('topic'),
                Type.Literal('entity'),
                Type.Literal('preference'),
                Type.Literal('tool'),
                Type.Literal('concept'),
                Type.Literal('other'),
              ]),
              baseWeight: Type.Integer({ minimum: 1, maximum: 5 }),
              l2Ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
            })
          )
        ),
      }),
      effect: 'read',
      replay: 'never',
      executionMode: 'sequential',
      execute: async (rawArgs: unknown, context) => {
        void bindingOf(context);
        const args = rawArgs as Record<string, unknown>;
        const kind = typeof args.kind === 'string' ? args.kind : '';
        const payload = { ...args };
        delete payload.kind;
        const active = state.current;
        if (!active)
          return {
            content: [{ type: 'text', text: 'No active memory stream item.' }],
            details: { status: 'rejected', code: 'NO_ACTIVE_ITEM' },
          };
        if (kind !== active.item.kind) {
          queue.finish(active.item.id, 'failed', 'STREAM_KIND_MISMATCH');
          state.current = undefined;
          return {
            content: [{ type: 'text', text: 'Memory stream item kind mismatch.' }],
            details: { status: 'rejected', code: 'STREAM_KIND_MISMATCH' },
          };
        }
        try {
          active.prepared.apply(payload);
          queue.finish(active.item.id, 'done', undefined);
          state.current = undefined;
          return {
            content: [{ type: 'text', text: 'Memory stream item applied.' }],
            details: { status: 'done', itemId: active.item.id },
          };
        } catch (error) {
          const code =
            error instanceof Error && 'code' in error ? String(error.code) : 'STREAM_APPLY_FAILED';
          queue.finish(active.item.id, 'failed', code);
          state.current = undefined;
          return {
            content: [{ type: 'text', text: `Memory stream item rejected: ${code}.` }],
            details: { status: 'rejected', itemId: active.item.id, code },
          };
        }
      },
    });
  });
}

export interface MemoryStreamAgentOptions extends Omit<
  PmemAgentRuntimeOptions,
  'plugin' | 'harnessContent' | 'harnessAssembly' | 'captureL0' | 'sessionTitle' | 'agentName'
> {
  workspaceId?: string;
  scopeId: string;
  access: MemoryAccess;
  contextBudgetTokens?: number;
  promptTimeoutMs?: number;
}

/**
 * One serial stream session. It owns the queue consumer and the persistent
 * context; there is no WorkerPool and no batch job.
 */
export class MemoryStreamAgent {
  private readonly state: { current?: ActiveItem };
  lastText?: string;
  lastItem?: MemoryStreamItem;
  private readonly queue: MemoryStreamRepository;
  private readonly sessions: MemoryStreamSessionRepository;
  private readonly contextBudgetTokens: number;

  private constructor(
    private readonly runtime: PmemAgentRuntime,
    queue: MemoryStreamRepository,
    sessions: MemoryStreamSessionRepository,
    private readonly workspaceId: string,
    private readonly scopeId: string,
    state: { current?: ActiveItem },
    contextBudgetTokens: number
  ) {
    this.queue = queue;
    this.sessions = sessions;
    this.state = state;
    this.contextBudgetTokens = contextBudgetTokens;
  }

  static async create(options: MemoryStreamAgentOptions): Promise<MemoryStreamAgent> {
    const workspaceId = options.workspaceId ?? PMEM_AGENT_WORKSPACE_ID;
    const scopeId = options.scopeId;
    const host =
      options.host ??
      createSingleUserAgentHost({
        workspaceId,
        spaceIds: options.access.readableSpaceIds,
      });
    const store = assembleMemoryStream(options.database);
    const saved = store.sessions.get(workspaceId, scopeId);
    const state: { current?: ActiveItem } = {};
    const plugin = await createStreamPlugin(state, store.queue);
    const runtime = await PmemAgentRuntime.create({
      ...options,
      host,
      plugin,
      harnessContent: () => structuredClone(HARNESS),
      harnessAssembly: ASSEMBLY,
      captureL0: false,
      agentName: 'PMEM Memory Stream',
      sessionTitle: 'PMEM Memory Stream',
      ...(saved ? { resume: { agentId: saved.agentId, sessionId: saved.sessionId } } : {}),
    });
    store.sessions.set(workspaceId, scopeId, runtime.agentId, runtime.sessionId);
    const agent = new MemoryStreamAgent(
      runtime,
      store.queue,
      store.sessions,
      workspaceId,
      scopeId,
      state,
      options.contextBudgetTokens ?? 700_000
    );
    return agent;
  }

  get sessionId(): string {
    return this.runtime.sessionId;
  }

  modelCalls() {
    return this.runtime.modelCalls();
  }

  cacheMetrics() {
    return this.runtime.cacheMetrics();
  }

  async runNext(handler: MemoryStreamHandler): Promise<boolean> {
    const next = this.queue.next(this.workspaceId, this.scopeId);
    if (!next) return false;
    const item = this.queue.claim(next.id);
    this.lastItem = item;
    let prepared: PreparedStreamItem;
    try {
      prepared = await handler.prepare(item);
    } catch (error) {
      this.queue.finish(
        item.id,
        'failed',
        error instanceof Error && 'code' in error ? String(error.code) : 'STREAM_PREPARE_FAILED'
      );
      return true;
    }
    this.state.current = { item, prepared };
    try {
      this.lastText = (
        await this.runtime.prompt(JSON.stringify(fitStreamEnvelope(prepared.envelope)))
      ).text;
      const current = this.queue.find(
        item.workspaceId,
        item.scopeId,
        item.kind,
        item.subjectId,
        item.sourceHash
      );
      if (current?.state === 'running')
        this.queue.finish(item.id, 'failed', 'STREAM_DID_NOT_SUBMIT');
      return true;
    } catch (error) {
      const current = this.queue.find(
        item.workspaceId,
        item.scopeId,
        item.kind,
        item.subjectId,
        item.sourceHash
      );
      if (current?.state === 'running')
        this.queue.finish(
          item.id,
          'unknown',
          error instanceof Error && 'code' in error ? String(error.code) : 'STREAM_FAILED'
        );
      throw error;
    } finally {
      this.state.current = undefined;
      this.storeContext();
      await this.rotateIfNeeded();
    }
  }

  async runUntilIdle(handler: MemoryStreamHandler, maxItems = 1000): Promise<number> {
    let processed = 0;
    while (processed < maxItems && (await this.runNext(handler))) processed++;
    return processed;
  }

  private storeContext(): void {
    this.sessions.setContext(this.workspaceId, this.scopeId, this.runtime.contextTokens());
  }

  private async rotateIfNeeded(): Promise<void> {
    if (this.contextBudgetTokens <= 0 || this.runtime.contextTokens() < this.contextBudgetTokens)
      return;
    await this.runtime.rotateSession();
    this.sessions.set(this.workspaceId, this.scopeId, this.runtime.agentId, this.runtime.sessionId);
  }

  async close(): Promise<void> {
    await this.runtime.close();
  }
}
