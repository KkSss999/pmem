import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { l3ScopeKey, type L3ChangeKind, type L3ChangeState } from '../../domain/memory/l3';
import {
  l2L1Links,
  l2Memories,
  l2SpaceLinks,
  l3JobResults,
  l3KeywordL2Links,
  l3KeywordSpaces,
  l3Keywords,
  l3Changes,
} from './schema';

type Db = Pick<
  BetterSQLite3Database,
  'select' | 'insert' | 'update' | 'delete' | 'get' | 'all' | 'run'
>;

function scopeOf(db: Db, l2Id: string): string[] | undefined {
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

export function l2SnapshotHash(db: Db, l2Id: string): string | undefined {
  const row = db.select().from(l2Memories).where(eq(l2Memories.id, l2Id)).get();
  if (!row) return undefined;
  const related = db
    .select({ spaceId: l2SpaceLinks.spaceId })
    .from(l2SpaceLinks)
    .where(eq(l2SpaceLinks.l2Id, l2Id))
    .all()
    .map((item) => item.spaceId)
    .sort();
  const l1Ids = db
    .select({ id: l2L1Links.l1Id })
    .from(l2L1Links)
    .where(eq(l2L1Links.l2Id, l2Id))
    .all()
    .map((item) => item.id)
    .sort();
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: row.title,
        summary: row.summary,
        body: row.body,
        contentHash: row.contentHash,
        visible: row.visible,
        ownerSpaceId: row.ownerSpaceId,
        relatedSpaceIds: related,
        l1Ids,
      })
    )
    .digest('hex');
}

export function recordL3Change(
  db: Db,
  input: {
    l2Id: string;
    kind: L3ChangeKind;
    l2Hash: string;
    state?: L3ChangeState;
    jobId?: string;
    reason?: string;
    now: string;
  }
): void {
  db.delete(l3Changes)
    .where(and(eq(l3Changes.l2Id, input.l2Id), eq(l3Changes.state, 'pending')))
    .run();
  const state = input.state ?? 'pending';
  db.insert(l3Changes)
    .values({
      id: randomUUID(),
      l2Id: input.l2Id,
      kind: input.kind,
      l2Hash: input.l2Hash,
      state,
      jobId: input.jobId ?? null,
      reason: input.reason ?? null,
      createdAt: input.now,
      processedAt: state === 'pending' ? null : input.now,
    })
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
  let sourceAliases: string[] = [];
  let targetAliases: string[] = [];
  try {
    const parsed: unknown = JSON.parse(source.aliasesJson);
    if (Array.isArray(parsed)) sourceAliases = parsed.filter((item) => typeof item === 'string');
  } catch {}
  try {
    const parsed: unknown = JSON.parse(target.aliasesJson);
    if (Array.isArray(parsed)) targetAliases = parsed.filter((item) => typeof item === 'string');
  } catch {}
  const aliases = [...new Set([...targetAliases, ...sourceAliases])];
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
  db.update(l3JobResults)
    .set({ keywordId: targetId })
    .where(eq(l3JobResults.keywordId, sourceId))
    .run();
  db.delete(l3KeywordL2Links).where(eq(l3KeywordL2Links.keywordId, sourceId)).run();
  db.delete(l3KeywordSpaces).where(eq(l3KeywordSpaces.keywordId, sourceId)).run();
  db.delete(l3Keywords).where(eq(l3Keywords.id, sourceId)).run();
}

function recomputeKeyword(db: Db, keywordId: string, now: string): void {
  const keyword = db.select().from(l3Keywords).where(eq(l3Keywords.id, keywordId)).get();
  if (!keyword) return;
  const sourceIds = db
    .select({ l2Id: l3KeywordL2Links.l2Id })
    .from(l3KeywordL2Links)
    .where(eq(l3KeywordL2Links.keywordId, keywordId))
    .all()
    .map((item) => item.l2Id);
  if (!sourceIds.length) {
    expireKeyword(db, keywordId, now);
    return;
  }
  let next: Set<string> | undefined;
  for (const sourceId of sourceIds) {
    const scope = scopeOf(db, sourceId);
    if (!scope) {
      expireKeyword(db, keywordId, now);
      return;
    }
    next = next ? new Set([...next].filter((spaceId) => scope.includes(spaceId))) : new Set(scope);
  }
  if (!next?.size) {
    expireKeyword(db, keywordId, now);
    return;
  }
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
    if (collision && collision.id !== keywordId) {
      mergeKeyword(db, keywordId, collision.id, now);
      return;
    }
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

export function registerL3ChangeForL2(
  db: Db,
  l2Id: string,
  kind: L3ChangeKind,
  now: string
): string | undefined {
  const hash = l2SnapshotHash(db, l2Id);
  if (!hash) return undefined;
  recordL3Change(db, { l2Id, kind, l2Hash: hash, now });
  return hash;
}
