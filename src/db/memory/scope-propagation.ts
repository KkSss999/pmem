import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { l3ScopeKey } from '../../domain/memory/l3';
import {
  l1Memories,
  l1SpaceLinks,
  l2L1Links,
  l2Memories,
  l2SpaceLinks,
  l3KeywordL2Links,
  l3KeywordSpaces,
  l3Keywords,
} from './schema';

type Db = Pick<
  BetterSQLite3Database,
  'select' | 'insert' | 'update' | 'delete' | 'get' | 'all' | 'run'
>;

function l1Scope(db: Db, l1Id: string): string[] | undefined {
  const row = db
    .select({ ownerSpaceId: l1Memories.spaceId })
    .from(l1Memories)
    .where(eq(l1Memories.id, l1Id))
    .get();
  if (!row) return undefined;
  const related = db
    .select({ spaceId: l1SpaceLinks.spaceId })
    .from(l1SpaceLinks)
    .where(eq(l1SpaceLinks.memoryId, l1Id))
    .all()
    .map((item) => item.spaceId);
  return [...new Set([row.ownerSpaceId, ...related])].sort();
}

function l2Scope(db: Db, l2Id: string): string[] | undefined {
  const row = db
    .select({ ownerSpaceId: l2Memories.ownerSpaceId, visible: l2Memories.visible })
    .from(l2Memories)
    .where(eq(l2Memories.id, l2Id))
    .get();
  if (!row || row.visible !== 1) return undefined;
  const related = db
    .select({ spaceId: l2SpaceLinks.spaceId })
    .from(l2SpaceLinks)
    .where(eq(l2SpaceLinks.l2Id, l2Id))
    .all()
    .map((item) => item.spaceId);
  return [...new Set([row.ownerSpaceId, ...related])].sort();
}

/** Narrow an L2 scope to the intersection of its linked L1 scopes, hiding it when empty. */
function recomputeL2Scope(db: Db, l2Id: string, now: string): void {
  const row = db.select().from(l2Memories).where(eq(l2Memories.id, l2Id)).get();
  if (!row) return;
  const oldLinks = db
    .select({ spaceId: l2SpaceLinks.spaceId })
    .from(l2SpaceLinks)
    .where(eq(l2SpaceLinks.l2Id, l2Id))
    .all()
    .map((item) => item.spaceId);
  const l1Ids = db
    .select({ id: l2L1Links.l1Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l2Id, l2Id))
    .all()
    .map((item) => item.id);
  const hide = (): void => {
    db.update(l2Memories)
      .set({ visible: 0, needsUpdate: 1, updatedAt: now })
      .where(eq(l2Memories.id, l2Id))
      .run();
  };
  if (!l1Ids.length) return hide();
  let next = new Set([row.ownerSpaceId, ...oldLinks]);
  for (const l1Id of l1Ids) {
    const scope = l1Scope(db, l1Id);
    if (!scope) return hide();
    next = new Set([...next].filter((id) => scope.includes(id)));
  }
  if (!next.size || !next.has(row.ownerSpaceId)) return hide();
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

function expireKeyword(db: Db, keywordId: string, now: string): void {
  db.update(l3Keywords)
    .set({ state: 'expired', needsRefresh: 1, updatedAt: now })
    .where(eq(l3Keywords.id, keywordId))
    .run();
}

function mergeKeyword(db: Db, sourceId: string, targetId: string, now: string): void {
  const source = db.select().from(l3Keywords).where(eq(l3Keywords.id, sourceId)).get();
  const target = db.select().from(l3Keywords).where(eq(l3Keywords.id, targetId)).get();
  if (!source || !target) return;
  const parse = (value: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  };
  const aliases = [...new Set([...parse(target.aliasesJson), ...parse(source.aliasesJson)])];
  db.update(l3Keywords)
    .set({
      aliasesJson: JSON.stringify(aliases),
      baseWeight: Math.max(source.baseWeight, target.baseWeight),
      weight: Math.max(source.weight, target.weight),
      hitCount: Math.max(source.hitCount, target.hitCount),
      lastHitAt:
        [source.lastHitAt, target.lastHitAt]
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      expiresAt: source.expiresAt > target.expiresAt ? source.expiresAt : target.expiresAt,
      needsRefresh: 1,
      state: 'active',
      updatedAt: now,
    })
    .where(eq(l3Keywords.id, targetId))
    .run();
  const links = db
    .select({ l2Id: l3KeywordL2Links.l2Id })
    .from(l3KeywordL2Links)
    .where(eq(l3KeywordL2Links.keywordId, sourceId))
    .all();
  if (links.length)
    db.insert(l3KeywordL2Links)
      .values(links.map((item) => ({ keywordId: targetId, l2Id: item.l2Id })))
      .onConflictDoNothing()
      .run();
  db.delete(l3KeywordL2Links).where(eq(l3KeywordL2Links.keywordId, sourceId)).run();
  db.delete(l3KeywordSpaces).where(eq(l3KeywordSpaces.keywordId, sourceId)).run();
  db.delete(l3Keywords).where(eq(l3Keywords.id, sourceId)).run();
}

/** Re-derive an L3 keyword's scope and links after its L2 sources changed. */
function recomputeKeyword(db: Db, keywordId: string, now: string): void {
  const keyword = db.select().from(l3Keywords).where(eq(l3Keywords.id, keywordId)).get();
  if (!keyword) return;
  const sourceIds = db
    .select({ l2Id: l3KeywordL2Links.l2Id })
    .from(l3KeywordL2Links)
    .where(eq(l3KeywordL2Links.keywordId, keywordId))
    .all()
    .map((item) => item.l2Id);
  if (!sourceIds.length) return expireKeyword(db, keywordId, now);
  let next: Set<string> | undefined;
  for (const sourceId of sourceIds) {
    const scope = l2Scope(db, sourceId);
    if (!scope) return expireKeyword(db, keywordId, now);
    next = next ? new Set([...next].filter((spaceId) => scope.includes(spaceId))) : new Set(scope);
  }
  if (!next?.size) return expireKeyword(db, keywordId, now);
  const related = [...next].sort();
  const scopeKey = l3ScopeKey(related);
  if (scopeKey !== keyword.scopeKey) {
    const collision = db
      .select({ id: l3Keywords.id })
      .from(l3Keywords)
      .where(
        and(
          eq(l3Keywords.scopeKey, scopeKey),
          eq(l3Keywords.normalizedTerm, keyword.normalizedTerm)
        )
      )
      .get();
    if (collision && collision.id !== keywordId)
      return mergeKeyword(db, keywordId, collision.id, now);
    db.update(l3Keywords)
      .set({ scopeKey, needsRefresh: 1, state: 'active', updatedAt: now })
      .where(eq(l3Keywords.id, keywordId))
      .run();
    db.delete(l3KeywordSpaces).where(eq(l3KeywordSpaces.keywordId, keywordId)).run();
    db.insert(l3KeywordSpaces)
      .values(related.map((spaceId) => ({ keywordId, spaceId })))
      .run();
    return;
  }
  db.update(l3Keywords)
    .set({ needsRefresh: 1, state: 'active', updatedAt: now })
    .where(eq(l3Keywords.id, keywordId))
    .run();
}

/** Re-evaluate every keyword that cites the L2 memory. */
export function invalidateL3ForL2Change(db: Db, l2Id: string, now: string): string[] {
  const keywordIds = db
    .select({ id: l3KeywordL2Links.keywordId })
    .from(l3KeywordL2Links)
    .where(eq(l3KeywordL2Links.l2Id, l2Id))
    .all()
    .map((item) => item.id);
  for (const keywordId of keywordIds) recomputeKeyword(db, keywordId, now);
  return keywordIds;
}

/** Re-point L2 evidence from a merged L1 memory onto the surviving one. */
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
    recomputeL2Scope(db, l2Id, now);
    invalidateL3ForL2Change(db, l2Id, now);
  }
  return affected;
}

/** Re-derive L2 scopes that depend on an L1 memory whose space links changed. */
export function invalidateL2ForScopeChange(db: Db, l1Id: string, now: string): string[] {
  const affected = db
    .select({ id: l2L1Links.l2Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l1Id, l1Id))
    .all()
    .map((item) => item.id);
  for (const l2Id of affected) {
    recomputeL2Scope(db, l2Id, now);
    invalidateL3ForL2Change(db, l2Id, now);
  }
  return affected;
}
