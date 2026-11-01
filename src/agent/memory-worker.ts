import type { MemoryStreamRepository } from '../db/memory/stream-repository';
import type { MemoryStreamItem } from '../domain/memory/stream';
import type { MemoryStreamModel } from './memory-model';
import type { MemoryStreamHandler, PreparedStreamItem } from './stream';

export interface MemoryStreamWorkerOptions {
  queue: MemoryStreamRepository;
  handler: MemoryStreamHandler;
  model: MemoryStreamModel;
  workspaceId: string;
  scopeId: string;
  onItem?: (event: MemoryStreamWorkerEvent) => void;
}

export interface MemoryStreamWorkerEvent {
  item: MemoryStreamItem;
  envelope: unknown;
  payload?: unknown;
  skipped?: boolean;
  error?: { code: string; message: string };
}

/**
 * Headless consumer for the memory queue: one structured model call per batch,
 * then the service applies it. No agent session, no tool loop, no extra turn.
 */
export class MemoryStreamWorker {
  constructor(private readonly options: MemoryStreamWorkerOptions) {}

  async runNext(): Promise<boolean> {
    const next = this.options.queue.next(this.options.workspaceId, this.options.scopeId);
    return next ? this.runItem(next) : false;
  }

  async runUntilIdle(maxItems = 1000): Promise<number> {
    let processed = 0;
    while (processed < maxItems && (await this.runNext())) processed++;
    return processed;
  }

  private async runItem(next: MemoryStreamItem): Promise<boolean> {
    const item = this.options.queue.claim(next.id);
    let prepared: PreparedStreamItem | null;
    try {
      prepared = await this.options.handler.prepare([item]);
    } catch (error) {
      this.options.queue.finish(item.id, 'failed', codeOf(error));
      this.options.onItem?.({
        item,
        envelope: null,
        error: { code: codeOf(error), message: messageOf(error) },
      });
      return true;
    }
    if (!prepared) {
      this.options.queue.finish(item.id, 'done', undefined);
      this.options.onItem?.({ item, envelope: null, skipped: true });
      return true;
    }
    let payload: unknown;
    try {
      payload = await this.options.model.run(item.kind, prepared.envelope);
      prepared.apply(payload);
      this.options.queue.finish(item.id, 'done', undefined);
      this.options.onItem?.({ item, envelope: prepared.envelope, payload });
    } catch (error) {
      this.options.queue.finish(item.id, 'failed', codeOf(error));
      this.options.onItem?.({
        item,
        envelope: prepared.envelope,
        payload,
        error: { code: codeOf(error), message: messageOf(error) },
      });
    }
    return true;
  }
}

function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'MEMORY_MODEL_FAILED';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
