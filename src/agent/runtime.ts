import { randomUUID } from 'node:crypto';
import type { AgentApplication } from '@miao/agent';
import type { AgentServiceClient, AgentServiceEvent } from '@miao/agent/client';
import type { OwnedDatabase } from '../db/database';
import type { ConversationRole } from '../domain/memory/types';
import { createSingleUserAgentHost, PMEM_AGENT_WORKSPACE_ID } from './access';
import type { PmemAgentHost } from './contracts';
import { pmemHarnessAssembly, pmemHarnessContent } from './harness';
import { AgentMemory } from './memory';
import { loadMiao } from './miao';
import { createLocalAgentPersistence } from './persistence';
import { createPmemMemoryPlugin } from './plugin';

const PROMPT_TIMEOUT_MS = 120_000;

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
  captureL0?: boolean;
}

export interface PmemPromptResult {
  text: string;
  sessionId: string;
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
    readonly workspaceId: string,
    readonly agentId: string,
    readonly sessionId: string,
    private readonly captureL0: boolean
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
    const plugin = await createPmemMemoryPlugin(memory, host);
    const { agent: miao, client: miaoClient } = await loadMiao();
    const application = miao.createAgentApplication({
      persistence,
      runtime: {
        harnessContent: pmemHarnessContent,
        harnessAssembly: pmemHarnessAssembly,
        faux: options.faux ?? false,
        ...(options.model ? { defaultModel: options.model } : {}),
      },
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
      const identity = await client.command(
        'identity.create',
        { workspaceId, parentAgentId: null, name: 'PMEM' },
        randomUUID()
      );
      const session = await client.command(
        'session.create',
        {
          workspaceId,
          agentId: identity.identity.agentId,
          title: 'PMEM Agent',
          ...(options.model ? { model: options.model } : {}),
        },
        randomUUID()
      );
      return new PmemAgentRuntime(
        application,
        client,
        local.close,
        memory,
        host,
        workspaceId,
        identity.identity.agentId,
        session.session.sessionId,
        options.captureL0 ?? true
      );
    } catch (error) {
      client.dispose();
      await application.close().catch(() => undefined);
      local.close();
      throw error;
    }
  }

  /** Send one user turn and return the next completed assistant text. */
  async prompt(text: string): Promise<PmemPromptResult> {
    if (!text.trim()) throw new Error('A prompt is required.');
    const waiter = this.waitForAssistant();
    try {
      const receipt = await this.client.command(
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
      if (this.captureL0) this.enqueueCapture('user', text, `user:${receipt.inputId}`, Date.now());
      return { text: await waiter.promise, sessionId: this.sessionId };
    } catch (error) {
      waiter.cancel();
      throw error;
    }
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
        this.memory.appendL0(
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
    }, PROMPT_TIMEOUT_MS);
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
