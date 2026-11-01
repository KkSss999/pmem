import type { L1Memory } from '../../domain/memory/l1';
import type { L2Memory } from '../../domain/memory/l2';
import {
  normalizeL3Term,
  type L3Draft,
  type L3Fallback,
  type L3Keyword,
  type L3KeywordMatch,
  type L3KeywordKind,
  type L3ListOptions,
  type L3MatchOptions,
  type L3ResolveOptions,
  type L3ResolveResult,
} from '../../domain/memory/l3';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { identifier, requireRead, validateAccess } from './index';
import type { L2Repository } from './l2-ports';
import type { L3Repository } from './l3-ports';
import type { L1Repository } from './l1-ports';
import type { MemoryRepository } from './ports';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_QUERY = 256;
const MAX_TERM = 64;
const MAX_ALIASES = 5;
const MAX_TERM_WORDS = 8;
const MAX_RESULTS = 100;
const KINDS: readonly L3KeywordKind[] = [
  'topic',
  'entity',
  'preference',
  'tool',
  'concept',
  'other',
];

export interface L3StreamPreparation {
  l2Id: string;
  l2Hash: string;
  memory: L2Memory;
  keywords: readonly L3Keyword[];
  now: string;
}

export interface L3ServiceOptions {
  ttlMs?: number;
  defaultLimit?: number;
  defaultTopK?: number;
  l1Limit?: number;
  graceMs?: number;
}

function intersectionScopes(scopes: readonly (readonly string[])[]): string[] {
  if (!scopes.length) return [];
  let result = new Set(scopes[0]);
  for (const scope of scopes.slice(1)) {
    const next = new Set(scope);
    result = new Set([...result].filter((id) => next.has(id)));
  }
  return [...result].sort();
}

function validateDraft(
  value: unknown,
  allowedL2Ids: ReadonlySet<string>,
  memories: ReadonlyMap<string, L2Memory>
): { draft: L3Draft; relatedSpaceIds: string[] } {
  if (!value || typeof value !== 'object')
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 keyword.');
  const item = value as Record<string, unknown>;
  const term = typeof item.term === 'string' ? item.term.trim() : '';
  const normalizedTerm = normalizeL3Term(term);
  if (
    !normalizedTerm ||
    term.length > MAX_TERM ||
    (/\s/.test(term) && term.split(/\s+/).length > MAX_TERM_WORDS) ||
    /[\r\n]/.test(term)
  )
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 term.');
  if (
    !Array.isArray(item.aliases) ||
    item.aliases.length > MAX_ALIASES ||
    item.aliases.some((alias) => typeof alias !== 'string')
  )
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 aliases.');
  const aliases = [
    ...new Set(item.aliases.map((alias) => (typeof alias === 'string' ? alias.trim() : ''))),
  ].filter(Boolean);
  if (
    aliases.some(
      (alias) =>
        alias.length > MAX_TERM ||
        (/\s/.test(alias) && alias.split(/\s+/).length > MAX_TERM_WORDS) ||
        /[\r\n]/.test(alias) ||
        normalizeL3Term(alias) === normalizedTerm
    )
  )
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 alias.');
  if (typeof item.kind !== 'string' || !KINDS.includes(item.kind as L3KeywordKind))
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 keyword kind.');
  if (
    !Number.isSafeInteger(item.baseWeight) ||
    (item.baseWeight as number) < 1 ||
    (item.baseWeight as number) > 5
  )
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Invalid L3 base weight.');
  if (!Array.isArray(item.l2Ids) || !item.l2Ids.length)
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'An L3 keyword needs source L2 IDs.');
  const l2Ids = [...new Set(item.l2Ids)];
  if (l2Ids.some((id) => typeof id !== 'string' || !allowedL2Ids.has(id as string)))
    throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'An L3 keyword cites an unavailable L2.');
  const scope = intersectionScopes(
    (l2Ids as string[]).map((id) => {
      const memory = memories.get(id);
      if (!memory) throw new MemoryError('L3_STALE_INPUT', 'An L2 source is unavailable.');
      return [memory.ownerSpaceId, ...memory.relatedSpaceIds];
    })
  );
  if (!scope.length) throw new MemoryError('L3_SCOPE_EMPTY', 'L3 keyword scope is empty.');
  return {
    draft: {
      term,
      aliases,
      kind: item.kind as L3KeywordKind,
      baseWeight: item.baseWeight as number,
      l2Ids: l2Ids as string[],
    },
    relatedSpaceIds: scope,
  };
}

function termsOf(query: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  return [
    ...new Set([
      normalizeL3Term(query),
      ...[...segmenter.segment(query)]
        .filter((item) => item.isWordLike)
        .map((item) => normalizeL3Term(item.segment)),
    ]),
  ].filter(Boolean);
}

function isL3IndexError(error: unknown): boolean {
  return (
    error instanceof MemoryError &&
    ['L3_INDEX_MISSING', 'L3_INDEX_STALE', 'L3_INDEX_CORRUPT', 'L3_INDEX_UNAVAILABLE'].includes(
      error.code
    )
  );
}

function isL2IndexError(error: unknown): boolean {
  return (
    error instanceof MemoryError &&
    ['L2_INDEX_MISSING', 'L2_INDEX_STALE', 'L2_INDEX_CORRUPT', 'L2_INDEX_UNAVAILABLE'].includes(
      error.code
    )
  );
}

function isL1IndexError(error: unknown): boolean {
  return (
    error instanceof MemoryError &&
    ['INDEX_MISSING', 'INDEX_STALE', 'INDEX_CORRUPT', 'INDEX_UNAVAILABLE'].includes(error.code)
  );
}

function mergeKeywords(items: readonly L3Keyword[]): L3KeywordMatch[] {
  const merged = new Map<string, L3KeywordMatch>();
  for (const item of items) {
    const current = merged.get(item.normalizedTerm);
    if (!current) {
      merged.set(item.normalizedTerm, {
        keywordIds: [item.id],
        term: item.term,
        normalizedTerm: item.normalizedTerm,
        aliases: [...item.aliases],
        kind: item.kind,
        weight: item.weight,
        baseWeight: item.baseWeight,
        hitCount: item.hitCount,
        ...(item.lastHitAt === undefined ? {} : { lastHitAt: item.lastHitAt }),
        relatedSpaceIds: [...item.relatedSpaceIds],
        sourceL2Ids: [...item.sourceL2Ids],
        sourceComplete: item.sourceComplete,
        needsRefresh: item.needsRefresh,
      });
      continue;
    }
    const representative = item.weight > current.weight ? item : current;
    merged.set(item.normalizedTerm, {
      keywordIds: [...current.keywordIds, item.id],
      term: representative.term,
      normalizedTerm: item.normalizedTerm,
      aliases: [...new Set([...current.aliases, ...item.aliases])],
      kind: representative.kind,
      weight: current.weight + item.weight,
      baseWeight: Math.max(current.baseWeight, item.baseWeight),
      hitCount: current.hitCount + item.hitCount,
      ...(current.lastHitAt === undefined && item.lastHitAt === undefined
        ? {}
        : {
            lastHitAt: [current.lastHitAt, item.lastHitAt]
              .filter((value): value is string => value !== undefined)
              .sort()
              .at(-1),
          }),
      relatedSpaceIds: [...new Set([...current.relatedSpaceIds, ...item.relatedSpaceIds])],
      sourceL2Ids: [...new Set([...current.sourceL2Ids, ...item.sourceL2Ids])],
      sourceComplete: current.sourceComplete && item.sourceComplete,
      needsRefresh: current.needsRefresh || item.needsRefresh,
    });
  }
  return [...merged.values()].sort(
    (left, right) =>
      right.weight - left.weight ||
      (right.lastHitAt ?? '').localeCompare(left.lastHitAt ?? '') ||
      left.normalizedTerm.localeCompare(right.normalizedTerm)
  );
}

export class L3Service {
  private readonly ttlMs: number;
  private readonly defaultLimit: number;
  private readonly defaultTopK: number;
  private readonly l1Limit: number;
  private readonly graceMs: number;

  constructor(
    private readonly repository: L3Repository,
    private readonly l2: L2Repository,
    private readonly l1: L1Repository,
    private readonly memory: MemoryRepository,
    private readonly readOnly: boolean,
    options: L3ServiceOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? 90 * DAY_MS;
    this.defaultLimit = options.defaultLimit ?? 10;
    this.defaultTopK = options.defaultTopK ?? 5;
    this.l1Limit = options.l1Limit ?? 20;
    this.graceMs = options.graceMs ?? 30 * DAY_MS;
    for (const value of [
      this.ttlMs,
      this.defaultLimit,
      this.defaultTopK,
      this.l1Limit,
      this.graceMs,
    ])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new MemoryError('INVALID_INPUT', 'Invalid L3 service options.');
  }

  private validateQuery(
    query: string,
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    limit: number
  ): { terms: string[]; anchored: string[] } {
    validateAccess(access);
    if (
      typeof query !== 'string' ||
      !query.trim() ||
      query.length > MAX_QUERY ||
      !Array.isArray(anchoredSpaceIds) ||
      !anchoredSpaceIds.length
    )
      throw new MemoryError('INVALID_INPUT', 'A query and anchored spaces are required.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new MemoryError('INVALID_INPUT', 'Invalid L3 limit.');
    const anchored = [...new Set(anchoredSpaceIds)];
    for (const spaceId of anchored) {
      identifier(spaceId, 'space ID');
      requireRead(access, spaceId);
      if (!this.memory.getSpace(spaceId))
        throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    }
    return { terms: termsOf(query).slice(0, 32), anchored };
  }

  private limit(value: number | undefined): number {
    const limit = value ?? this.defaultLimit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new MemoryError('INVALID_INPUT', 'Invalid L3 limit.');
    return limit;
  }

  private recordHits(matches: readonly L3KeywordMatch[]): void {
    if (this.readOnly || !matches.length) return;
    const ids = [...new Set(matches.flatMap((match) => match.keywordIds))];
    if (!ids.length) return;
    const now = new Date().toISOString();
    try {
      this.repository.recordHits(ids, now, this.expiry(now));
    } catch {
      // Hit accounting is derived data; a write failure must not hide readable facts.
    }
  }

  private expiry(now: string): string {
    return new Date(Date.parse(now) + this.ttlMs).toISOString();
  }

  match(
    query: string,
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    options: L3MatchOptions = {}
  ): L3KeywordMatch[] {
    const limit = this.limit(options.limit);
    const { terms, anchored } = this.validateQuery(query, anchoredSpaceIds, access, limit);
    const matches = mergeKeywords(
      this.repository.match(
        terms,
        anchored,
        access.readableSpaceIds,
        new Date().toISOString(),
        Math.min(100, limit * 5)
      )
    ).slice(0, limit);
    this.recordHits(matches);
    return matches;
  }

  list(
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    options: L3ListOptions = {}
  ): L3KeywordMatch[] {
    validateAccess(access);
    if (!Array.isArray(anchoredSpaceIds) || !anchoredSpaceIds.length)
      throw new MemoryError('INVALID_INPUT', 'Anchored spaces are required.');
    const limit = this.limit(options.limit);
    const anchored = [...new Set(anchoredSpaceIds)];
    for (const spaceId of anchored) {
      identifier(spaceId, 'space ID');
      requireRead(access, spaceId);
      if (!this.memory.getSpace(spaceId))
        throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    }
    return mergeKeywords(
      this.repository.list(
        anchored,
        access.readableSpaceIds,
        new Date().toISOString(),
        Math.min(100, limit * 5)
      )
    ).slice(0, limit);
  }

  getKeyword(id: string, access: MemoryAccess): L3Keyword | undefined {
    identifier(id, 'L3 keyword ID');
    validateAccess(access);
    return this.repository.getKeyword(id, access.readableSpaceIds, new Date().toISOString());
  }

  resolve(
    query: string,
    anchoredSpaceIds: readonly string[],
    access: MemoryAccess,
    options: L3ResolveOptions = {}
  ): L3ResolveResult {
    const limit = this.limit(options.limit);
    const topK = options.topK ?? this.defaultTopK;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100)
      throw new MemoryError('INVALID_INPUT', 'Invalid L3 top-k.');
    const { terms, anchored } = this.validateQuery(query, anchoredSpaceIds, access, limit);
    const now = new Date().toISOString();
    let keywords: L3KeywordMatch[] = [];
    let keywordTruncated = false;
    let incomplete = false;
    try {
      const matched = mergeKeywords(
        this.repository.match(
          terms,
          anchored,
          access.readableSpaceIds,
          now,
          Math.min(100, limit * 5)
        )
      );
      keywordTruncated = matched.length > limit;
      keywords = matched.slice(0, limit);
      this.recordHits(keywords);
    } catch (cause) {
      if (!isL3IndexError(cause)) throw cause;
      incomplete = true;
    }

    const sourceL2Ids = [...new Set(keywords.flatMap((keyword) => keyword.sourceL2Ids))];
    const l2ById = new Map<string, L2Memory>();
    for (const id of sourceL2Ids) {
      const memory = this.l2.getMemory(id, access.readableSpaceIds);
      if (!memory || !memory.visible) {
        incomplete = true;
        continue;
      }
      l2ById.set(memory.id, memory);
    }
    let l2 = [...l2ById.values()];
    let mixed = false;
    let fallback: L3Fallback = 'none';
    const allowFallback = options.fallback !== false;

    if (allowFallback && (l2.length < topK || !l2.length)) {
      let searched: L2Memory[] = [];
      try {
        searched = this.l2.search(
          terms,
          anchored,
          access.readableSpaceIds,
          Math.max(1, topK - l2.length)
        );
      } catch (cause) {
        if (!isL2IndexError(cause)) throw cause;
        incomplete = true;
      }
      const added = searched.filter((memory) => !l2ById.has(memory.id));
      if (added.length) {
        mixed = l2.length > 0;
        fallback = 'l2';
        for (const memory of added) l2ById.set(memory.id, memory);
        l2 = [...l2ById.values()];
      } else if (!l2.length) {
        fallback = 'l2';
      }
    }
    l2 = l2.slice(0, topK);

    const l1ById = new Map<string, L1Memory>();
    for (const memory of l2) {
      for (const l1Id of memory.l1Ids) {
        const evidence = this.l1.getMemory(l1Id, access.readableSpaceIds);
        if (!evidence) {
          incomplete = true;
          continue;
        }
        l1ById.set(evidence.id, evidence);
      }
      if (!memory.sourcesComplete) incomplete = true;
    }
    let l1 = [...l1ById.values()];
    if (allowFallback && !l2.length) {
      try {
        l1 = this.l1.searchMemories(terms, anchored, access.readableSpaceIds, this.l1Limit);
        if (l1.length) fallback = 'l1';
      } catch (cause) {
        if (!isL1IndexError(cause)) throw cause;
        incomplete = true;
      }
    }
    l1 = l1.slice(0, this.l1Limit);

    const l0SourceIds = [
      ...new Set([
        ...l2.flatMap((memory) => memory.sourceIds),
        ...(fallback === 'l1' ? l1.flatMap((memory) => memory.sourceIds) : []),
      ]),
    ].sort();
    const truncated = sourceL2Ids.length > topK || keywordTruncated;

    return {
      cacheHit: keywords.length > 0 && l2.length > 0,
      mixed,
      fallback,
      keywords,
      l2,
      l1,
      l0SourceIds,
      complete: !incomplete && !truncated,
      needsRefresh:
        keywords.some((keyword) => keyword.needsRefresh) || l2.some((memory) => memory.needsUpdate),
      truncated,
    };
  }

  streamSourceHash(l2Id: string): string | undefined {
    identifier(l2Id, 'L2 ID');
    return this.repository.l2Hash(l2Id);
  }

  prepareStream(l2Id: string, expectedHash: string, access: MemoryAccess): L3StreamPreparation {
    identifier(l2Id, 'L2 ID');
    identifier(expectedHash, 'L2 hash');
    validateAccess(access);
    const memory = this.l2.getMemory(l2Id, access.readableSpaceIds);
    if (
      !memory ||
      !memory.visible ||
      !memory.sourcesComplete ||
      !access.readableSpaceIds.includes(memory.ownerSpaceId) ||
      this.repository.l2Hash(l2Id) !== expectedHash
    )
      throw new MemoryError('L3_STALE_INPUT', 'An L2 source is unavailable for streaming.');
    const now = new Date().toISOString();
    return {
      l2Id,
      l2Hash: expectedHash,
      memory,
      keywords: this.repository.listRelatedKeywords([l2Id], now, 100),
      now,
    };
  }

  applyStream(
    preparation: L3StreamPreparation,
    raw: unknown,
    access: MemoryAccess
  ): readonly string[] {
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (this.repository.l2Hash(preparation.l2Id) !== preparation.l2Hash)
      throw new MemoryError('L3_STALE_INPUT', 'An L2 source changed before stream commit.');
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { keywords?: unknown }).keywords))
      throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'L3 output must contain keywords.');
    const rawKeywords = (raw as { keywords: unknown[] }).keywords;
    if (rawKeywords.length > MAX_RESULTS)
      throw new MemoryError('L3_MODEL_OUTPUT_INVALID', 'Too many L3 keywords.');
    const memory = preparation.memory;
    const allowed = new Set([memory.id]);
    const memories = new Map([[memory.id, memory]]);
    const committed: string[] = [];
    for (const rawKeyword of rawKeywords) {
      const validated = validateDraft(rawKeyword, allowed, memories);
      const normalizedTerm = normalizeL3Term(validated.draft.term);
      const existing = preparation.keywords.find(
        (keyword) =>
          keyword.normalizedTerm === normalizedTerm &&
          keyword.sourceL2Ids.some((id) => validated.draft.l2Ids.includes(id))
      );
      const keyword = this.repository.upsertKeyword({
        id: existing?.id,
        term: validated.draft.term,
        aliases: validated.draft.aliases,
        kind: validated.draft.kind,
        baseWeight: validated.draft.baseWeight,
        relatedSpaceIds: validated.relatedSpaceIds,
        sourceL2Ids: validated.draft.l2Ids,
        expiresAt: this.expiry(preparation.now),
        now: preparation.now,
        mergeSources: true,
      });
      committed.push(keyword.id);
    }
    return committed;
  }
}
