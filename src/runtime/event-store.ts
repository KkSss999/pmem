import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MemoryEvent, MemoryEventType, WorkingMemory } from './types';
import { parseDurationMs } from './policy';

interface EventRow {
  id: string;
  type: MemoryEventType;
  scope: string;
  created_at: string;
  payload_json: string;
  expires_at: string | null;
}

export class EventStore {
  constructor(
    private readonly db: Database.Database,
    private readonly workingTtl = '12h',
  ) {
    this.createSchema();
  }

  append(event: Omit<MemoryEvent, 'id' | 'created_at'> & Partial<Pick<MemoryEvent, 'id' | 'created_at'>>): MemoryEvent {
    const createdAt = event.created_at ?? new Date().toISOString();
    const complete: MemoryEvent = {
      id: event.id ?? randomUUID(),
      type: event.type,
      scope: event.scope,
      created_at: createdAt,
      payload: event.payload,
    };
    this.db.prepare(
      'INSERT INTO events (id, type, scope, created_at, payload_json, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(complete.id, complete.type, complete.scope, complete.created_at, JSON.stringify(complete.payload), this.expiryFor(complete));
    return complete;
  }

  find(id: string): MemoryEvent | null {
    const row = this.db.prepare(
      'SELECT id, type, scope, created_at, payload_json, expires_at FROM events WHERE id = ?'
    ).get(id) as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  replay(since?: string): MemoryEvent[] {
    const rows = since
      ? this.db.prepare('SELECT id, type, scope, created_at, payload_json, expires_at FROM events WHERE created_at >= ? ORDER BY created_at ASC, rowid ASC').all(since) as EventRow[]
      : this.db.prepare('SELECT id, type, scope, created_at, payload_json, expires_at FROM events ORDER BY created_at ASC, rowid ASC').all() as EventRow[];
    return rows.map(toEvent);
  }

  working(scope: string): WorkingMemory {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      'SELECT id, type, scope, created_at, payload_json, expires_at FROM events WHERE scope = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC, rowid ASC'
    ).all(scope, now) as EventRow[];
    const events = rows.map(toEvent);
    const expiries = rows.map(r => r.expires_at).filter((v): v is string => !!v).sort();
    return { scope, events, expires_at: expiries[0] };
  }

  expire(): number {
    return this.db.prepare('DELETE FROM events WHERE expires_at IS NOT NULL AND expires_at <= ?').run(new Date().toISOString()).changes;
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_scope_created ON events(scope, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);
    `);
  }

  private expiryFor(event: MemoryEvent): string | null {
    if (event.type !== 'observe') return null;
    const ttlMs = parseDurationMs(this.workingTtl);
    if (!ttlMs) return null;
    return new Date(Date.parse(event.created_at) + ttlMs).toISOString();
  }
}

function toEvent(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    type: row.type,
    scope: row.scope,
    created_at: row.created_at,
    payload: safeJson(row.payload_json),
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { value };
  }
}
