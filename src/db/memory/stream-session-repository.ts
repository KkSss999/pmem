import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { memoryStreamSessions } from './stream-schema';

export interface MemoryStreamSession {
  workspaceId: string;
  scopeId: string;
  agentId: string;
  sessionId: string;
  contextTokens: number;
  updatedAt: string;
}

export class MemoryStreamSessionRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  get(workspaceId: string, scopeId: string): MemoryStreamSession | undefined {
    const row = this.db
      .select()
      .from(memoryStreamSessions)
      .where(
        and(
          eq(memoryStreamSessions.workspaceId, workspaceId),
          eq(memoryStreamSessions.scopeId, scopeId)
        )
      )
      .get();
    if (!row) return undefined;
    return {
      workspaceId: row.workspaceId,
      scopeId: row.scopeId,
      agentId: row.agentId,
      sessionId: row.sessionId,
      contextTokens: row.contextTokens,
      updatedAt: row.updatedAt,
    };
  }

  set(
    workspaceId: string,
    scopeId: string,
    agentId: string,
    sessionId: string,
    contextTokens = 0,
    now = new Date().toISOString()
  ): MemoryStreamSession {
    this.db
      .insert(memoryStreamSessions)
      .values({ workspaceId, scopeId, agentId, sessionId, contextTokens, updatedAt: now })
      .onConflictDoUpdate({
        target: [memoryStreamSessions.workspaceId, memoryStreamSessions.scopeId],
        set: { agentId, sessionId, contextTokens, updatedAt: now },
      })
      .run();
    return { workspaceId, scopeId, agentId, sessionId, contextTokens, updatedAt: now };
  }

  setContext(
    workspaceId: string,
    scopeId: string,
    contextTokens: number,
    now = new Date().toISOString()
  ): void {
    this.db
      .update(memoryStreamSessions)
      .set({ contextTokens, updatedAt: now })
      .where(
        and(
          eq(memoryStreamSessions.workspaceId, workspaceId),
          eq(memoryStreamSessions.scopeId, scopeId)
        )
      )
      .run();
  }
}
