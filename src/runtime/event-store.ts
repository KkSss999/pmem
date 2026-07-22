import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MemoryEvent, MemoryEventType, WorkingMemory } from './types';
import { parseDurationMs } from './policy';

interface EventRow {
  id: string;
  event_type?: string;
  type?: MemoryEventType;
  memory_id?: string | null;
  branch?: string | null;
  scope?: string;
  created_at: string;
  payload?: string | null;
  payload_json?: string;
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
    const payloadJson = JSON.stringify(complete.payload);
    const numericId = Number(complete.id);
    const canUseProvidedId = Number.isInteger(numericId) && numericId > 0;
    const result = canUseProvidedId
      ? this.db.prepare(
          'INSERT OR REPLACE INTO events (id, event_type, memory_id, branch, payload, created_at, session_id, success, type, scope, payload_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(numericId, runtimeEventType(complete.type), payloadMemoryId(complete.payload), branchFromScope(complete.scope), payloadJson, complete.created_at, null, 1, complete.type, complete.scope, payloadJson, this.expiryFor(complete))
      : this.db.prepare(
          'INSERT INTO events (event_type, memory_id, branch, payload, created_at, session_id, success, type, scope, payload_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(runtimeEventType(complete.type), payloadMemoryId(complete.payload), branchFromScope(complete.scope), payloadJson, complete.created_at, null, 1, complete.type, complete.scope, payloadJson, this.expiryFor(complete));
    return { ...complete, id: String(canUseProvidedId ? numericId : result.lastInsertRowid) };
  }

  find(id: string): MemoryEvent | null {
    const row = this.db.prepare(
      'SELECT id, event_type, type, memory_id, branch, scope, created_at, payload, payload_json, expires_at FROM events WHERE id = ?'
    ).get(id) as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  replay(since?: string): MemoryEvent[] {
    const rows = since
      ? this.db.prepare('SELECT id, event_type, type, memory_id, branch, scope, created_at, payload, payload_json, expires_at FROM events WHERE created_at >= ? ORDER BY created_at ASC, rowid ASC').all(since) as EventRow[]
      : this.db.prepare('SELECT id, event_type, type, memory_id, branch, scope, created_at, payload, payload_json, expires_at FROM events ORDER BY created_at ASC, rowid ASC').all() as EventRow[];
    return rows.map(toEvent);
  }

  working(scope: string): WorkingMemory {
    const now = new Date().toISOString();
    const rows = this.db.prepare(
      `SELECT id, event_type, type, memory_id, branch, scope, created_at, payload, payload_json, expires_at
       FROM events
       WHERE scope = ?
         AND (expires_at IS NULL OR expires_at > ?)
         AND COALESCE(event_type, '') != 'memory.forget.tombstone'
         AND NOT EXISTS (
           SELECT 1 FROM events f
           WHERE f.event_type = 'memory.forget.tombstone'
             AND (f.memory_id = events.id OR f.memory_id = events.memory_id OR json_extract(f.payload, '$.target_id') = events.id)
         )
       ORDER BY created_at ASC, rowid ASC`
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        memory_id TEXT,
        branch TEXT,
        payload TEXT,
        created_at TEXT NOT NULL,
        session_id TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        type TEXT,
        scope TEXT,
        payload_json TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_scope_created ON events(scope, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_expires ON events(expires_at);
    `);
    for (const column of [
      'type TEXT', 'scope TEXT', 'payload_json TEXT', 'expires_at TEXT',
      'event_type TEXT', 'memory_id TEXT', 'branch TEXT', 'payload TEXT', 'session_id TEXT', 'success INTEGER NOT NULL DEFAULT 1'
    ]) {
      try { this.db.exec(`ALTER TABLE events ADD COLUMN ${column}`); } catch {}
    }
  }

  private expiryFor(event: MemoryEvent): string | null {
    if (event.type !== 'observe') return null;
    const ttlMs = parseDurationMs(this.workingTtl);
    if (!ttlMs) return null;
    return new Date(Date.parse(event.created_at) + ttlMs).toISOString();
  }
}

function toEvent(row: EventRow): MemoryEvent {
  const type = row.type ?? toMemoryEventType(row.event_type);
  const payload = safeJson(row.payload_json ?? row.payload ?? '{}');
  return {
    id: String(row.id),
    type,
    scope: row.scope ?? scopeFromBranch(row.branch),
    created_at: row.created_at,
    payload,
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

function runtimeEventType(type: MemoryEventType): string {
  if (type === 'observe') return 'memory.observe';
  if (type === 'commit') return 'memory.capture.committed';
  if (type === 'forget') return 'memory.forget.tombstone';
  return `memory.${type}`;
}

function toMemoryEventType(eventType?: string): MemoryEventType {
  if (eventType === 'memory.capture.committed') return 'commit';
  if (eventType === 'memory.forget.tombstone') return 'forget';
  if (eventType === 'memory.observe') return 'observe';
  if (eventType?.includes('session_end')) return 'session_end';
  if (eventType?.includes('supersede')) return 'supersede';
  return 'observe';
}

function payloadMemoryId(payload: Record<string, unknown>): string | null {
  const target = payload.target_id ?? payload.memory_id;
  return typeof target === 'string' ? target : null;
}

function branchFromScope(scope: string): string | null {
  return scope.startsWith('branch:') ? scope.slice('branch:'.length) : null;
}

function scopeFromBranch(branch?: string | null): string {
  return branch ? `branch:${branch}` : 'project';
}
