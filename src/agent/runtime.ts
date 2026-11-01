import { randomUUID } from 'node:crypto';
import type { AgentApplication, AgentApplicationOptions } from '@miao/agent';
import type { AgentServiceClient, AgentServiceEvent } from '@miao/agent/client';
import type { HarnessAssemblyContribution, HarnessCatalogDocument } from '@miao/agent/harness';
import type { CompiledExtension } from '@miao/agent/plugins';
import type { OwnedDatabase } from '../db/database';
import { assembleL1 } from '../server/l1';
import { assembleMemoryStream } from '../server/stream';
import type { ConversationRole } from '../domain/memory/types';
import { createSingleUserAgentHost, PMEM_AGENT_WORKSPACE_ID } from './access';
import type { PmemAgentHost } from './contracts';
import { pmemHarnessAssembly, pmemHarnessContent } from './harness';
import { AgentMemory } from './memory';
import { loadMiao } from './miao';
import { createLocalAgentPersistence } from './persistence';
import { createPmemMemoryPlugin } from './plugin';

const PROMPT_TIMEOUT_MS = 120_000;

type MiaoProviders = NonNullable<AgentApplicationOptions['providers']>;
type MiaoModelCatalog = NonNullable<AgentApplicationOptions['runtime']['modelCatalog']>;

export interface PmemModelSelection {
  providerId: string;
  modelId: string;
  api?: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxOutputTokens?: number;
}

export interface PmemAgentRuntimeOptions {
  /** Caller owns the database and closes it after the runtime. */
  database: OwnedDatabase;
  /** Durable MiaoTs receipt/harness database; separate from the PMEM Memory DB. */
  agentDatabasePath: string;
  workspaceId?: string;
  spaceIds?: readonly string[];
  l0SpaceId?: string;
  host?: PmemAgentHost;
  /** Deterministic local provider for tests. */
  faux?: boolean;
  model?: PmemModelSelection;
  providers?: MiaoProviders;
  modelCatalog?: MiaoModelCatalog;
  captureL0?: boolean;
  plugin?: CompiledExtension;
  harnessContent?: () => HarnessCatalogDocument;
  harnessAssembly?: HarnessAssemblyContribution;
  agentName?: string;
  sessionTitle?: string;
  resume?: { agentId: string; sessionId: string };
  promptTimeoutMs?: number;
  /** When set, captured user/assistant L0 messages enqueue L1 stream items. */
  streamScopeId?: string;
}

export interface PmemPromptResult {
  text: string;
  sessionId: string;
}

export interface PmemTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

export interface PmemCostUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface PmemCacheMetrics {
  requestId: string;
  providerId: string;
  modelId: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Provider-reported cache read share of the prompt tokens for this call. */
  hitRate: number;
}

export interface PmemModelCall {
  requestId: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  status: 'started' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  usage?: { tokens: PmemTokenUsage; cost: PmemCostUsage };
}

class ModelCallCollector {
  private readonly rows = new Map<string, PmemModelCall>();

  write(entry: { record: PmemModelCall }): Promise<void> {
    this.rows.set(entry.record.requestId, structuredClone(entry.record));
    return Promise.resolve();
  }

  list(): readonly PmemModelCall[] {
    return [...this.rows.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((record) => structuredClone(record));
  }
}

function eventOf(event: AgentServiceEvent) {
  if (event.name !== 'activity.event') return undefined;
  return event.payload;
}

function assistantText(event: AgentServiceEvent): string | undefined {
  const payload = eventOf(event);
  if (!payload || payload.event.type !== 'message-completed') return undefined;
  if (payload.event.role !== 'assistant') return undefined;
  const text = payload.event.text.trim();
  return text ? payload.event.text : undefined;
}

function captureEvent(
  event: AgentServiceEvent
): { text: string; sourceEventId: string; at: number } | undefined {
  const payload = eventOf(event);
  if (!payload) return undefined;
  if (payload.event.type === 'message-completed' && payload.event.role === 'assistant') {
    if (!payload.event.text.trim()) return undefined;
    return {
      text: payload.event.text,
      sourceEventId: `assistant:${payload.event.runId}:${payload.event.at}`,
      at: payload.event.at,
    };
  }
  return undefined;
}

/**
 * First PMEM Agent slice: MiaoTs owns the Agent loop; PMEM owns memory,
 * Harness content, read tools, and L0 capture.
 */
export class PmemAgentRuntime {
  private captureQueue: Promise<void> = Promise.resolve();
  private captureError: unknown;
  private unsubscribeCapture?: () => void;

  private constructor(
    private readonly application: AgentApplication,
    private readonly client: AgentServiceClient,
    private readonly closePersistence: () => void,
    readonly memory: AgentMemory,
    private readonly host: PmemAgentHost,
    private readonly modelCallsStore: ModelCallCollector,
    private readonly recallQueries: Map<string, string>,
    readonly workspaceId: string,
    readonly agentId: string,
    public sessionId: string,
    private readonly sessionTitle: string,
    private readonly captureL0: boolean,
    private readonly promptTimeoutMs: number,
    private readonly stream?: {
      queue: import('../db/memory/stream-repository').MemoryStreamRepository;
      l1: import('../service/memory/l1').L1Service;
      scopeId: string;
    }
  ) {
    if (captureL0) this.subscribeCapture();
  }

  static async create(options: PmemAgentRuntimeOptions): Promise<PmemAgentRuntime> {
    const workspaceId = options.workspaceId ?? PMEM_AGENT_WORKSPACE_ID;
    const host =
      options.host ??
      createSingleUserAgentHost({
        workspaceId,
        ...(options.spaceIds ? { spaceIds: options.spaceIds } : {}),
        ...(options.l0SpaceId ? { l0SpaceId: options.l0SpaceId } : {}),
      });
    const memory = new AgentMemory(options.database);
    const local = await createLocalAgentPersistence(options.agentDatabasePath);
    const persistence = local.persistence;
    const recallQueries = new Map<string, string>();
    const modelCalls = new ModelCallCollector();
    const plugin =
      options.plugin ??
      (await createPmemMemoryPlugin(memory, host, {
        queryFor: (binding) => recallQueries.get(binding.sessionId),
      }));
    const { agent: miao, client: miaoClient } = await loadMiao();
    const application = miao.createAgentApplication({
      persistence,
      runtime: {
        harnessContent: options.harnessContent ?? pmemHarnessContent,
        harnessAssembly: options.harnessAssembly ?? pmemHarnessAssembly,
        faux: options.faux ?? false,
        modelCallSink: modelCalls,
        ...(options.model ? { defaultModel: options.model } : {}),
        ...(options.modelCatalog ? { modelCatalog: options.modelCatalog } : {}),
      },
      ...(options.providers ? { providers: options.providers } : {}),
      plugins: [plugin],
    });
    const endpoint = application.bindAuthenticatedCaller({
      kind: 'host',
      hostId: 'pmem',
      label: 'PMEM Agent Runtime',
    });
    const client = new miao.AgentServiceClient(miaoClient.createInProcessAgentTransport(endpoint));
    try {
      await client.start(randomUUID());
      let agentId: string;
      let sessionId: string;
      const resumed = options.resume
        ? await client.query(
            'session.get',
            {
              target: {
                workspaceId,
                agentId: options.resume.agentId,
                sessionId: options.resume.sessionId,
              },
            },
            randomUUID()
          )
        : null;
      if (resumed) {
        agentId = options.resume!.agentId;
        sessionId = resumed.sessionId;
      } else {
        const identity = await client.command(
          'identity.create',
          { workspaceId, parentAgentId: null, name: options.agentName ?? 'PMEM' },
          randomUUID()
        );
        const session = await client.command(
          'session.create',
          {
            workspaceId,
            agentId: identity.identity.agentId,
            title: options.sessionTitle ?? 'PMEM Agent',
            ...(options.model ? { model: options.model } : {}),
          },
          randomUUID()
        );
        agentId = identity.identity.agentId;
        sessionId = session.session.sessionId;
      }
      const streamScopeId =
        options.streamScopeId ??
        host.scope({
          workspaceId,
          agentId,
          sessionId,
        }).l0SpaceId;
      const streamStore = assembleMemoryStream(options.database);
      return new PmemAgentRuntime(
        application,
        client,
        local.close,
        memory,
        host,
        modelCalls,
        recallQueries,
        workspaceId,
        agentId,
        sessionId,
        options.sessionTitle ?? 'PMEM Agent',
        options.captureL0 ?? true,
        options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS,
        options.captureL0 === false
          ? undefined
          : {
              queue: streamStore.queue,
              l1: assembleL1(options.database),
              scopeId: streamScopeId,
            }
      );
    } catch (error) {
      client.dispose();
      await application.close().catch(() => undefined);
      local.close();
      throw error;
    }
  }

  /** Start a fresh session for the same Agent when the context budget is reached. */
  async rotateSession(): Promise<string> {
    const result = await this.client.command(
      'session.create',
      {
        workspaceId: this.workspaceId,
        agentId: this.agentId,
        title: `${this.sessionTitle} (rotated)`,
      },
      randomUUID()
    );
    this.sessionId = result.session.sessionId;
    if (this.captureL0) {
      this.unsubscribeCapture?.();
      this.subscribeCapture();
    }
    return this.sessionId;
  }

  /** Send one user turn and return the next completed assistant text. */
  async prompt(text: string): Promise<PmemPromptResult> {
    if (!text.trim()) throw new Error('A prompt is required.');
    const waiter = this.waitForAssistant();
    this.recallQueries.set(this.sessionId, text);
    if (this.captureL0) this.enqueueCapture('user', text, `user:${randomUUID()}`, Date.now());
    try {
      await this.client.command(
        'input.send',
        {
          target: {
            workspaceId: this.workspaceId,
            agentId: this.agentId,
            sessionId: this.sessionId,
          },
          text,
          mode: 'queue',
        },
        randomUUID()
      );
      return { text: await waiter.promise, sessionId: this.sessionId };
    } catch (error) {
      waiter.cancel();
      throw error;
    } finally {
      this.recallQueries.delete(this.sessionId);
    }
  }

  /** Model-call accounting exposed by MiaoTs; cacheRead is provider-reported. */
  modelCalls(): readonly PmemModelCall[] {
    return this.modelCallsStore.list();
  }

  /** Provider-reported prompt size of the most recent model call. */
  contextTokens(): number {
    const calls = this.modelCallsStore.list();
    const usage = calls[calls.length - 1]?.usage?.tokens;
    if (!usage) return 0;
    return usage.input + usage.cacheRead + usage.cacheWrite;
  }

  cacheMetrics(): readonly PmemCacheMetrics[] {
    return this.modelCallsStore.list().map((call) => {
      const tokens = call.usage?.tokens;
      const input = tokens?.input ?? 0;
      const cacheRead = tokens?.cacheRead ?? 0;
      const cacheWrite = tokens?.cacheWrite ?? 0;
      const prompt = input + cacheRead + cacheWrite;
      return {
        requestId: call.requestId,
        providerId: call.providerId,
        modelId: call.modelId,
        input,
        cacheRead,
        cacheWrite,
        hitRate: prompt ? cacheRead / prompt : 0,
      };
    });
  }

  /** Read a persisted transcript; defaults to this runtime's current Session. */
  sessionTranscript(sessionId = this.sessionId, agentId: string | null = this.agentId) {
    return this.client.query(
      'session.transcript',
      {
        target: { workspaceId: this.workspaceId, agentId, sessionId },
      },
      randomUUID()
    );
  }

  /** Read the latest prepared context manifest, including auto-recall provenance. */
  contextSnapshot() {
    return this.client.inspectContext(
      {
        workspaceId: this.workspaceId,
        agentId: this.agentId,
        sessionId: this.sessionId,
      },
      randomUUID()
    );
  }

  /** List durable Sessions in this Agent workspace. */
  async listSessions(): Promise<
    readonly { sessionId: string; agentId: string | null; title: string | null }[]
  > {
    const page = await this.client.query(
      'session.list',
      { workspaceId: this.workspaceId },
      randomUUID()
    );
    return page.items.map((session) => ({
      sessionId: session.sessionId,
      agentId: session.agentId,
      title: session.title,
    }));
  }

  /** Wait for pending L0 captures; useful before asserting or closing. */
  async flushCapture(): Promise<void> {
    await this.captureQueue;
    if (this.captureError) throw this.captureError;
  }

  async close(): Promise<void> {
    this.unsubscribeCapture?.();
    try {
      await this.flushCapture();
    } finally {
      this.client.dispose();
      await this.application.close();
      this.closePersistence();
    }
  }

  private subscribeCapture(): void {
    this.unsubscribeCapture = this.client.subscribe(
      (event) => {
        const captured = captureEvent(event);
        if (!captured) return;
        this.enqueueCapture('assistant', captured.text, captured.sourceEventId, captured.at);
      },
      { sessionId: this.sessionId }
    );
  }

  private enqueueCapture(
    role: ConversationRole,
    text: string,
    sourceEventId: string,
    at: number
  ): void {
    const scope = this.host.scope({
      workspaceId: this.workspaceId,
      agentId: this.agentId,
      sessionId: this.sessionId,
    });
    this.captureQueue = this.captureQueue
      .then(() => {
        const appended = this.memory.appendL0(
          {
            spaceId: scope.l0SpaceId,
            role,
            content: text,
            source: 'pmem.agent',
            sourceEventId,
            sessionId: this.sessionId,
            occurredAt: new Date(at).toISOString(),
          },
          scope.access
        );
        if (this.stream)
          this.stream.queue.enqueue({
            workspaceId: this.workspaceId,
            scopeId: this.stream.scopeId,
            kind: 'l1-extract',
            subjectId: appended.message.id,
            sourceHash: this.stream.l1.streamSourceHash(appended.message.id, scope.access),
          });
      })
      .catch((error: unknown) => {
        this.captureError ??= error;
      });
  }

  private waitForAssistant(): { promise: Promise<string>; cancel: () => void } {
    let unsubscribe: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let resolve!: (value: string) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
    const cancel = () => {
      cleanup();
      reject(new Error('Agent prompt cancelled.'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the Agent response.'));
    }, this.promptTimeoutMs);
    unsubscribe = this.client.subscribe(
      (event) => {
        if (settled) return;
        const text = assistantText(event);
        if (text === undefined) return;
        cleanup();
        resolve(text);
      },
      { sessionId: this.sessionId }
    );
    return { promise, cancel };
  }
}
