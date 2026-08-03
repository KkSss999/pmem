import type {
  MemoryDiffChange,
  MemoryDiffResult,
  MemoryEvent,
  MemoryHistoryEntry,
  MemoryHistoryOptions,
  MemoryHistoryResult,
} from './model';

const DEFAULT_HISTORY_LIMIT = 100;

export function buildMemoryHistory(memoryId: string, events: readonly MemoryEvent[], options: MemoryHistoryOptions = {}): MemoryHistoryResult {
  const from = options.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
  const to = options.to ? Date.parse(options.to) : Number.POSITIVE_INFINITY;
  const limit = normalizeLimit(options.limit);
  const entries = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.record_id === memoryId || payloadRecordId(event) === memoryId)
    .filter(({ event }) => {
      const timestamp = Date.parse(event.recorded_at || event.occurred_at);
      return timestamp >= from && timestamp <= to;
    })
    .sort((left, right) => Date.parse(left.event.recorded_at) - Date.parse(right.event.recorded_at)
      || (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index)
    // Backends may return a bounded latest window. Keep the same defensive
    // rule here so a backend that returns a larger history cannot make the
    // public limit select the oldest entries.
    .slice(-limit)
    .map(({ event }) => historyEntry(memoryId, event));
  return {
    memoryId,
    entries,
    ...(entries.some(entry => entry.diffStatus === 'unavailable')
      ? { warnings: ['Some historical events do not contain before/after snapshots; field-level diff is unavailable.'] }
      : {}),
  };
}

export function buildMemoryDiff(memoryId: string, events: readonly MemoryEvent[], options: MemoryHistoryOptions = {}): MemoryDiffResult {
  // Diff is intentionally a two-point view: always use the latest two events,
  // regardless of how many older timeline entries exist.
  const history = buildMemoryHistory(memoryId, events, { ...options, limit: DEFAULT_HISTORY_LIMIT });
  const previous = history.entries.length > 1 ? history.entries[history.entries.length - 2] : null;
  const current = history.entries.at(-1) ?? null;
  const changes = current?.changes;
  return {
    memoryId,
    previous,
    current,
    diffStatus: changes ? 'available' : 'unavailable',
    ...(changes ? { changes } : {}),
    ...(history.warnings ? { warnings: history.warnings } : {}),
  };
}

function historyEntry(memoryId: string, event: MemoryEvent): MemoryHistoryEntry {
  const payload = event.payload ?? {};
  const changes = diffChanges(payload);
  const entry: MemoryHistoryEntry = {
    eventId: event.id,
    type: event.type,
    recordId: memoryId,
    occurredAt: event.occurred_at,
    recordedAt: event.recorded_at,
    scope: typeof event.scope === 'string' ? event.scope : event.scope.id,
    diffStatus: changes ? 'available' : 'unavailable',
  };
  const actor = stringValue(payload.actor) ?? stringValue(payload.principal);
  const reason = stringValue(payload.reason) ?? stringValue(payload.summary);
  const source = stringValue(payload.source) ?? stringValue(payload.source_id) ?? stringValue(payload.file);
  if (actor) entry.actor = actor;
  if (reason) entry.reason = reason;
  if (source) entry.source = source;
  if (changes) entry.changes = changes;
  return entry;
}

function diffChanges(payload: Record<string, unknown>): readonly MemoryDiffChange[] | undefined {
  const raw = payload.changes ?? payload.changedFields;
  if (Array.isArray(raw)) {
    const changes = raw
      .map(item => {
        if (typeof item === 'string') return { path: item };
        if (!item || typeof item !== 'object') return null;
        const value = item as Record<string, unknown>;
        return typeof value.path === 'string'
          ? { path: value.path, ...(Object.prototype.hasOwnProperty.call(value, 'before') ? { before: value.before } : {}), ...(Object.prototype.hasOwnProperty.call(value, 'after') ? { after: value.after } : {}) }
          : null;
      })
      .filter((item): item is MemoryDiffChange => item !== null);
    return changes.length > 0 ? changes : undefined;
  }
  const before = payload.before;
  const after = payload.after;
  if (!isObject(before) || !isObject(after)) return undefined;
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: MemoryDiffChange[] = [];
  for (const path of [...paths].sort()) {
    if (JSON.stringify(before[path]) !== JSON.stringify(after[path])) {
      changes.push({ path, before: before[path], after: after[path] });
    }
  }
  return changes.length > 0 ? changes : undefined;
}

function payloadRecordId(event: MemoryEvent): string | undefined {
  const payload = event.payload ?? {};
  for (const key of ['record_id', 'memory_id', 'target_id']) {
    if (typeof payload[key] === 'string') return payload[key] as string;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeLimit(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(500, Math.max(1, Math.floor(value)));
}
