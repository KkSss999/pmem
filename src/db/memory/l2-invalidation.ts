import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { L2ChangeKind, L2ChangeState } from '../../domain/memory/l2';
import {
  l1Cues,
  l1Memories,
  l1Sources,
  l1SpaceLinks,
  l2Changes,
  l2L1Links,
  l2Memories,
  l2SpaceLinks,
} from './schema';

type Db = Pick<
  BetterSQLite3Database,
  'select' | 'insert' | 'update' | 'delete' | 'get' | 'all' | 'run'
>;

interface Snapshot {
  id: string;
  ownerSpaceId: string;
  content: string;
  abstraction: string;
  cues: readonly string[];
  scope: readonly string[];
  sourceIds: readonly string[];
}

function hashSnapshot(snapshot: Snapshot): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        content: snapshot.content,
        abstraction: snapshot.abstraction,
        cues: [...snapshot.cues],
        spaceId: snapshot.ownerSpaceId,
        relatedSpaceIds: snapshot.scope.filter((id) => id !== snapshot.ownerSpaceId).sort(),
        sourceIds: [...snapshot.sourceIds].sort(),
      })
    )
    .digest('hex');
}

function snapshot(db: Db, l1Id: string): Snapshot | undefined {
  const row = db.select().from(l1Memories).where(eq(l1Memories.id, l1Id)).get();
  if (!row) return undefined;
  const cues = db
    .select({ value: l1Cues.cue })
    .from(l1Cues)
    .where(eq(l1Cues.memoryId, l1Id))
    .all()
    .map((item) => item.value)
    .sort();
  const sourceIds = db
    .select({ value: l1Sources.l0Id })
    .from(l1Sources)
    .where(eq(l1Sources.memoryId, l1Id))
    .all()
    .map((item) => item.value)
    .sort();
  const scope = db
    .select({ value: l1SpaceLinks.spaceId })
    .from(l1SpaceLinks)
    .where(eq(l1SpaceLinks.memoryId, l1Id))
    .all()
    .map((item) => item.value);
  return {
    id: l1Id,
    ownerSpaceId: row.spaceId,
    content: row.content,
    abstraction: row.abstraction,
    cues,
    scope: [...new Set([row.spaceId, ...scope])].sort(),
    sourceIds,
  };
}

export function hashMaintenanceSnapshot(input: {
  spaceId: string;
  content: string;
  abstraction: string;
  cues: readonly string[];
  scope: readonly string[];
  sourceIds: readonly string[];
}): string {
  return hashSnapshot({
    id: '',
    ownerSpaceId: input.spaceId,
    content: input.content,
    abstraction: input.abstraction,
    cues: input.cues,
    scope: input.scope,
    sourceIds: input.sourceIds,
  });
}

export function recordL2Change(
  db: Db,
  input: {
    l1Id: string;
    ownerSpaceId: string;
    kind: L2ChangeKind;
    l1Hash: string;
    state?: L2ChangeState;
    survivorL1Id?: string;
    reason?: string;
    now: string;
  }
): void {
  db.delete(l2Changes)
    .where(and(eq(l2Changes.l1Id, input.l1Id), eq(l2Changes.state, 'pending')))
    .run();
  const state = input.state ?? 'pending';
  db.insert(l2Changes)
    .values({
      id: randomUUID(),
      l1Id: input.l1Id,
      ownerSpaceId: input.ownerSpaceId,
      kind: input.kind,
      l1Hash: input.l1Hash,
      survivorL1Id: input.survivorL1Id ?? null,
      state,
      reason: input.reason ?? null,
      createdAt: input.now,
      processedAt: state === 'pending' ? null : input.now,
    })
    .run();
}

function recomputeScope(db: Db, l2Id: string, now: string): void {
  const row = db.select().from(l2Memories).where(eq(l2Memories.id, l2Id)).get();
  if (!row) return;
  const oldLinks = db
    .select({ spaceId: l2SpaceLinks.spaceId })
    .from(l2SpaceLinks)
    .where(eq(l2SpaceLinks.l2Id, l2Id))
    .all()
    .map((item) => item.spaceId);
  const currentScope = new Set([row.ownerSpaceId, ...oldLinks]);
  const l1Ids = db
    .select({ id: l2L1Links.l1Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l2Id, l2Id))
    .all()
    .map((item) => item.id);
  if (!l1Ids.length) {
    db.update(l2Memories)
      .set({ visible: 0, needsUpdate: 1, updatedAt: now })
      .where(eq(l2Memories.id, l2Id))
      .run();
    return;
  }
  let next = currentScope;
  for (const l1Id of l1Ids) {
    const item = snapshot(db, l1Id);
    if (!item) {
      db.update(l2Memories)
        .set({ visible: 0, needsUpdate: 1, updatedAt: now })
        .where(eq(l2Memories.id, l2Id))
        .run();
      return;
    }
    const scope = new Set(item.scope);
    next = new Set([...next].filter((id) => scope.has(id)));
  }
  if (!next.size || !next.has(row.ownerSpaceId)) {
    db.update(l2Memories)
      .set({ visible: 0, needsUpdate: 1, updatedAt: now })
      .where(eq(l2Memories.id, l2Id))
      .run();
    return;
  }
  db.delete(l2SpaceLinks).where(eq(l2SpaceLinks.l2Id, l2Id)).run();
  const related = [...next].filter((id) => id !== row.ownerSpaceId).sort();
  if (related.length)
    db.insert(l2SpaceLinks)
      .values(related.map((spaceId) => ({ l2Id, spaceId })))
      .run();
  db.update(l2Memories)
    .set({ visible: 1, needsUpdate: 1, updatedAt: now })
    .where(eq(l2Memories.id, l2Id))
    .run();
}

export function migrateL2LinksForMerge(
  db: Db,
  sourceL1Id: string,
  targetL1Id: string,
  now: string
): string[] {
  const affected = db
    .select({ id: l2L1Links.l2Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l1Id, sourceL1Id))
    .all()
    .map((item) => item.id);
  for (const l2Id of affected) {
    db.insert(l2L1Links).values({ l2Id, l1Id: targetL1Id }).onConflictDoNothing().run();
    db.delete(l2L1Links)
      .where(and(eq(l2L1Links.l2Id, l2Id), eq(l2L1Links.l1Id, sourceL1Id)))
      .run();
    recomputeScope(db, l2Id, now);
  }
  return affected;
}

export function invalidateL2ForScopeChange(db: Db, l1Id: string, now: string): string[] {
  const affected = db
    .select({ id: l2L1Links.l2Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l1Id, l1Id))
    .all()
    .map((item) => item.id);
  for (const l2Id of affected) recomputeScope(db, l2Id, now);
  return affected;
}

export function l1SnapshotHash(db: Db, l1Id: string): string | undefined {
  const item = snapshot(db, l1Id);
  return item ? hashSnapshot(item) : undefined;
}
