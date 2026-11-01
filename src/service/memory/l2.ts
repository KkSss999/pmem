import { createHash, randomUUID } from 'node:crypto';
import { MEMORY_CHANGE_TYPES, type MemoryChangeJudge } from '../../domain/memory/decision';
import type { L1Memory } from '../../domain/memory/l1';
import type {
  L2Candidate,
  L2Draft,
  L2GenerationChange,
  L2IndexStatus,
  L2Memory,
} from '../../domain/memory/l2';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { identifier, requireRead, validateAccess } from './index';
import type { MemoryRepository } from './ports';
import type { L1Repository } from './l1-ports';
import type { L2Repository } from './l2-ports';

const JUDGE_LIMIT = 3;
const MAX_TITLE = 200;
const MAX_SUMMARY = 1000;
const MAX_BODY = 20_000;
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function l1Scope(memory: L1Memory): string[] {
  return [...new Set([memory.spaceId, ...memory.relatedSpaceIds])].sort();
}

function l1Hash(memory: L1Memory): string {
  return hash({
    content: memory.content,
    abstraction: memory.abstraction,
    cues: memory.cues,
    spaceId: memory.spaceId,
    relatedSpaceIds: [...memory.relatedSpaceIds].sort(),
    sourceIds: [...memory.sourceIds].sort(),
  });
}

function l2Hash(input: { title: string; summary: string; body: string }): string {
  return hash({ title: input.title, summary: input.summary, body: input.body });
}

function candidateTerms(changes: readonly L2GenerationChange[]): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const text = changes
    .flatMap((item) => [item.memory.content, item.memory.abstraction, ...item.memory.cues])
    .join(' ')
    .slice(0, 8192);
  return [
    ...new Set(
      [...segmenter.segment(text)]
        .filter((item) => item.isWordLike)
        .map((item) => item.segment.toLowerCase())
    ),
  ].slice(0, 32);
}

function intersection(scopes: readonly (readonly string[])[]): string[] {
  if (!scopes.length) return [];
  let result = new Set(scopes[0]);
  for (const scope of scopes.slice(1)) {
    const next = new Set(scope);
    result = new Set([...result].filter((id) => next.has(id)));
  }
  return [...result].sort();
}

interface Proposal {
  results: L2Draft[];
  uncovered: { l1Id: string; reason: string }[];
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', `Invalid ${field}.`);
  return value.trim();
}

function validateProposal(
  value: unknown,
  changes: readonly L2GenerationChange[],
  candidates: readonly L2Candidate[]
): Proposal {
  if (!value || typeof value !== 'object')
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'L2 output must be an object.');
  const object = value as { results?: unknown; uncoveredL1Ids?: unknown };
  if (!Array.isArray(object.results))
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'L2 output must contain results.');
  if (object.uncoveredL1Ids !== undefined && !Array.isArray(object.uncoveredL1Ids))
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'uncoveredL1Ids must be an array.');

  const changeIds = new Set(changes.map((item) => item.l1Id));
  const candidateById = new Map(candidates.map((item) => [item.memory.id, item]));
  const allLinkedIds = new Set(
    candidates.flatMap((candidate) => candidate.memory.l1Ids.map((id) => id))
  );
  const updateIds = new Set<string>();
  const allResultIds = (drafts: readonly L2Draft[]): Set<string> =>
    new Set(drafts.flatMap((draft) => draft.l1Ids));
  const results = object.results.map((raw): L2Draft => {
    if (!raw || typeof raw !== 'object')
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid L2 result.');
    const item = raw as Record<string, unknown>;
    if (item.action !== 'create' && item.action !== 'update')
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid L2 action.');
    if (!Array.isArray(item.l1Ids) || !item.l1Ids.length)
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A result needs source L1 IDs.');
    const l1Ids = [...new Set(item.l1Ids)];
    if (l1Ids.some((id) => typeof id !== 'string'))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid L1 ID.');
    const allowed = item.action === 'create' ? changeIds : new Set([...changeIds, ...allLinkedIds]);
    if (l1Ids.some((id) => !allowed.has(id as string)))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A result references unavailable L1.');
    const title = text(item.title, 'title', MAX_TITLE);
    const summary = text(item.summary, 'summary', MAX_SUMMARY);
    const body = text(item.body, 'body', MAX_BODY);
    if (item.action === 'create') return { action: 'create', title, summary, body, l1Ids };
    if (typeof item.l2Id !== 'string' || !candidateById.has(item.l2Id))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'An update needs a candidate L2 ID.');
    if (updateIds.has(item.l2Id))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A candidate L2 is updated twice.');
    updateIds.add(item.l2Id);
    const candidate = candidateById.get(item.l2Id)!;
    if (item.supersede !== undefined && typeof item.supersede !== 'boolean')
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid supersede flag.');
    const supersede = item.supersede === true;
    if (!supersede && candidate.memory.l1Ids.some((id) => !l1Ids.includes(id)))
      throw new MemoryError(
        'L2_MODEL_OUTPUT_INVALID',
        'An update must preserve all existing L1 links unless it supersedes them.'
      );
    return {
      action: 'update',
      l2Id: item.l2Id,
      supersede,
      title,
      summary,
      body,
      l1Ids,
    };
  });

  const uncovered = (object.uncoveredL1Ids ?? []).map((raw) => {
    if (!raw || typeof raw !== 'object')
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid uncovered L1.');
    const item = raw as Record<string, unknown>;
    if (typeof item.l1Id !== 'string' || !changeIds.has(item.l1Id))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid uncovered L1 ID.');
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 1000)
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Invalid uncovered reason.');
    return { l1Id: item.l1Id, reason: item.reason.trim() };
  });
  const uncoveredIds = new Set<string>();
  for (const item of uncovered) {
    if (uncoveredIds.has(item.l1Id))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'Duplicate uncovered L1 ID.');
    uncoveredIds.add(item.l1Id);
  }
  // A change the model silently skipped is left as an L1-only fact instead of
  // failing the whole batch: the L1 stays readable evidence and the next change
  // to it is synthesized normally.
  const coveredIds = allResultIds(results);
  if ([...uncoveredIds].some((id) => coveredIds.has(id)))
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A changed L1 is both covered and uncovered.');
  for (const change of changes) {
    if (coveredIds.has(change.l1Id) || uncoveredIds.has(change.l1Id)) continue;
    uncovered.push({ l1Id: change.l1Id, reason: 'model did not cover this change' });
    uncoveredIds.add(change.l1Id);
  }
  return { results, uncovered };
}

export interface QueueL2Input {
  id: string;
  ownerSpaceId: string;
}

export interface L2ServiceOptions {
  judge?: MemoryChangeJudge;
}

export interface L2StreamPreparation {
  l1Ids: readonly string[];
  /** Changes that were left out because their L1 memory is not ready yet. */
  deferredL1Ids: readonly string[];
  ownerSpaceId: string;
  loaded: readonly L2GenerationChange[];
  candidates: readonly L2Candidate[];
  candidatesForModel: readonly L2Candidate[];
  replacementByCandidate: ReadonlyMap<string, ReadonlySet<string>>;
  now: string;
}

export interface L2StreamResult {
  committed: number;
  skipped: number;
  l2Ids: readonly string[];
}

export class L2Service {
  constructor(
    private readonly repository: L2Repository,
    private readonly l1: L1Repository,
    private readonly memory: MemoryRepository,
    private readonly readOnly: boolean,
    private readonly options: L2ServiceOptions = {}
  ) {}

  streamSourceHash(l1Id: string, access: MemoryAccess): string {
    identifier(l1Id, 'L1 ID');
    validateAccess(access);
    const memory = this.l1.getMemory(l1Id, access.readableSpaceIds);
    if (!memory) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
    return l1Hash(memory);
  }

  /**
   * Prepare one L2 generation for a batch of changed L1 memories. Each L1 is one
   * change; candidates are shared, so the prompt carries one candidate set.
   */
  async prepareStream(
    l1Ids: string | readonly string[],
    access: MemoryAccess
  ): Promise<L2StreamPreparation> {
    if (typeof l1Ids === 'string') l1Ids = [l1Ids];
    if (!Array.isArray(l1Ids) || !l1Ids.length)
      throw new MemoryError('INVALID_INPUT', 'At least one L1 memory is required.');
    const ids = [...new Set(l1Ids)];
    validateAccess(access);
    // A batch may contain an L1 whose maintenance is still pending (or failed).
    // Skipping it keeps the rest of the batch usable instead of failing it all.
    const loaded: L2GenerationChange[] = [];
    const deferred: string[] = [];
    for (const l1Id of ids) {
      identifier(l1Id, 'L1 ID');
      const memory = this.l1.getMemory(l1Id, access.readableSpaceIds);
      if (!memory || memory.maintenanceStatus !== 'complete' || !memory.sourcesComplete) {
        deferred.push(l1Id);
        continue;
      }
      requireRead(access, memory.spaceId);
      loaded.push({ l1Id, kind: 'created', memory });
    }
    if (!loaded.length)
      throw new MemoryError('INVALID_INPUT', 'L1 memory is not ready for L2 streaming.');
    const ownerSpaceId = loaded[0].memory.spaceId;
    if (loaded.some((entry) => entry.memory.spaceId !== ownerSpaceId))
      throw new MemoryError('INVALID_INPUT', 'A batch must stay inside one space.');
    const now = new Date().toISOString();
    const linked = this.repository.listLinkedCandidates(
      ownerSpaceId,
      ids,
      access.readableSpaceIds,
      10
    );
    let searched: L2Memory[] = [];
    try {
      searched = this.repository.search(
        candidateTerms(loaded),
        [ownerSpaceId],
        access.readableSpaceIds,
        10
      );
    } catch (cause) {
      if (
        !(cause instanceof MemoryError) ||
        ![
          'L2_INDEX_MISSING',
          'L2_INDEX_STALE',
          'L2_INDEX_CORRUPT',
          'L2_INDEX_UNAVAILABLE',
        ].includes(cause.code)
      )
        throw cause;
      searched = this.repository.listCandidates(ownerSpaceId, access.readableSpaceIds, 10);
    }
    const candidates: L2Candidate[] = [];
    const byId = new Map<string, L2Memory>();
    for (const candidate of [...linked, ...searched]) byId.set(candidate.id, candidate);
    for (const candidate of [...byId.values()].slice(0, 10)) {
      const evidence = candidate.l1Ids
        .map((id) => this.l1.getMemory(id, access.readableSpaceIds))
        .filter((item): item is L1Memory => item !== undefined);
      if (evidence.length === candidate.l1Ids.length)
        candidates.push({ memory: candidate, evidence });
    }
    const changes = loaded.map((entry) => ({
      id: entry.l1Id,
      content: entry.memory.content,
      createdAt: entry.memory.createdAt,
    }));
    const replacementByCandidate = new Map<string, ReadonlySet<string>>();
    let candidatesForModel = candidates;
    if (this.options.judge && candidates.length) {
      // Judging is one remote request per candidate, so it runs concurrently and
      // only for the closest candidates.
      const limit = Math.min(candidates.length, JUDGE_LIMIT);
      const decided = await Promise.all(
        candidates.slice(0, limit).map(async (candidate) => {
          const judgments = await this.options.judge!.judge({
            current: {
              title: candidate.memory.title,
              summary: candidate.memory.summary,
              body: candidate.memory.body,
              updatedAt: candidate.memory.updatedAt,
            },
            changes,
          });
          return { candidate, judgments };
        })
      ).catch((cause: unknown) => {
        throw new MemoryError('L2_DECISION_FAILED', 'Memory change judgment failed.', { cause });
      });
      const judged: L2Candidate[] = [];
      for (const { candidate, judgments } of decided) {
        if (!Array.isArray(judgments) || judgments.length !== changes.length)
          throw new MemoryError('L2_DECISION_FAILED', 'Memory change judgment was incomplete.');
        const replaced = new Set<string>();
        for (const judgment of judgments) {
          if (
            !judgment ||
            !ids.includes(judgment.changedL1Id) ||
            !MEMORY_CHANGE_TYPES.includes(judgment.type)
          )
            throw new MemoryError('L2_DECISION_FAILED', 'Memory change judgment was invalid.');
          if (judgment.type === 'replacement') replaced.add(judgment.changedL1Id);
        }
        if (replaced.size) replacementByCandidate.set(candidate.memory.id, replaced);
        if (replaced.size < changes.length) judged.push(candidate);
      }
      candidatesForModel = [...judged, ...candidates.slice(limit)];
    }
    return {
      l1Ids: loaded.map((entry) => entry.l1Id),
      deferredL1Ids: deferred,
      ownerSpaceId,
      loaded,
      candidates,
      candidatesForModel,
      replacementByCandidate,
      now,
    };
  }

  applyStream(
    preparation: L2StreamPreparation,
    raw: unknown,
    access: MemoryAccess
  ): L2StreamResult {
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    for (const entry of preparation.loaded) {
      const current = this.l1.getMemory(entry.l1Id, access.readableSpaceIds);
      if (!current || l1Hash(current) !== l1Hash(entry.memory))
        throw new MemoryError('L2_STALE_INPUT', 'The L1 source changed before stream commit.');
    }
    const proposal = validateProposal(raw, preparation.loaded, preparation.candidatesForModel);
    const known = new Map<string, L1Memory>();
    for (const entry of preparation.loaded) known.set(entry.l1Id, entry.memory);
    for (const candidate of preparation.candidates)
      for (const evidence of candidate.evidence) known.set(evidence.id, evidence);
    const candidateById = new Map(
      preparation.candidatesForModel.map((item) => [item.memory.id, item])
    );
    const replacementTarget = new Map<string, string>();
    let committed = 0;
    let skipped = 0;
    const l2Ids: string[] = [];
    const now = new Date().toISOString();
    for (const draft of proposal.results) {
      const used = draft.l1Ids.map((id) => {
        const item = known.get(id);
        if (!item) throw new MemoryError('L2_STALE_INPUT', 'An L1 source is unavailable.');
        return item;
      });
      const scope = intersection(used.map(l1Scope));
      if (!scope.includes(preparation.ownerSpaceId))
        throw new MemoryError('L2_SCOPE_EMPTY', 'No common scope.');
      const relatedSpaceIds = scope.filter((id) => id !== preparation.ownerSpaceId);
      const sourceIds = [...new Set(used.flatMap((item) => item.sourceIds))].sort();
      const contentHash = l2Hash(draft);
      const generationId = randomUUID();
      if (draft.action === 'update') {
        const candidate = draft.l2Id ? candidateById.get(draft.l2Id) : undefined;
        if (!candidate) throw new MemoryError('L2_STALE_INPUT', 'L2 candidate unavailable.');
        const current = this.repository.getMemory(candidate.memory.id, access.readableSpaceIds);
        if (!current) throw new MemoryError('L2_STALE_INPUT', 'L2 candidate unavailable.');
        const unchanged =
          current.visible &&
          !current.needsUpdate &&
          current.title === draft.title &&
          current.summary === draft.summary &&
          current.body === draft.body &&
          JSON.stringify([...current.l1Ids].sort()) === JSON.stringify([...draft.l1Ids].sort()) &&
          JSON.stringify(current.relatedSpaceIds) === JSON.stringify(relatedSpaceIds) &&
          JSON.stringify(current.sourceIds) === JSON.stringify(sourceIds);
        if (unchanged) {
          skipped++;
          l2Ids.push(current.id);
        } else {
          const applied = this.repository.applyUpdate({
            ownerSpaceId: preparation.ownerSpaceId,
            l2Id: current.id,
            expectedHash: candidate.memory.contentHash,
            expectedL1Ids: candidate.memory.l1Ids,
            title: draft.title,
            summary: draft.summary,
            body: draft.body,
            l1Ids: draft.l1Ids,
            sourceIds,
            relatedSpaceIds,
            generationId,
            contentHash,
            now,
          });
          committed++;
          l2Ids.push(applied.id);
          for (const [oldId, triggers] of preparation.replacementByCandidate)
            if (!replacementTarget.has(oldId) && draft.l1Ids.some((id) => triggers.has(id)))
              replacementTarget.set(oldId, applied.id);
        }
      } else {
        const created = this.repository.applyCreate({
          ownerSpaceId: preparation.ownerSpaceId,
          title: draft.title,
          summary: draft.summary,
          body: draft.body,
          l1Ids: draft.l1Ids,
          sourceIds,
          relatedSpaceIds,
          generationId,
          contentHash,
          now,
        });
        committed++;
        l2Ids.push(created.id);
        for (const [oldId, triggers] of preparation.replacementByCandidate)
          if (!replacementTarget.has(oldId) && draft.l1Ids.some((id) => triggers.has(id)))
            replacementTarget.set(oldId, created.id);
      }
    }
    for (const [oldId, newId] of replacementTarget) {
      const candidate = preparation.candidates.find((item) => item.memory.id === oldId);
      if (candidate && candidate.memory.id !== newId)
        this.repository.applySupersede(oldId, newId, candidate.memory.contentHash, now);
    }
    return { committed, skipped, l2Ids };
  }

  getMemory(id: string, access: MemoryAccess): L2Memory | undefined {
    identifier(id, 'L2 ID');
    validateAccess(access);
    return this.repository.getMemory(id, access.readableSpaceIds);
  }

  listMemories(
    options: { ownerSpaceId: string; limit?: number },
    access: MemoryAccess
  ): L2Memory[] {
    if (!options || typeof options !== 'object')
      throw new MemoryError('INVALID_INPUT', 'List options are required.');
    identifier(options.ownerSpaceId, 'space ID');
    requireRead(access, options.ownerSpaceId);
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new MemoryError('INVALID_INPUT', 'Invalid pagination limit.');
    return this.repository.listMemories(options.ownerSpaceId, access.readableSpaceIds, limit);
  }

  recall(
    options: { query: string; anchoredSpaceIds: readonly string[]; limit?: number },
    access: MemoryAccess
  ): L2Memory[] {
    validateAccess(access);
    if (
      !options ||
      typeof options.query !== 'string' ||
      !options.query.trim() ||
      options.query.length > 256 ||
      !Array.isArray(options.anchoredSpaceIds) ||
      !options.anchoredSpaceIds.length
    )
      throw new MemoryError('INVALID_INPUT', 'A query and anchored spaces are required.');
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new MemoryError('INVALID_INPUT', 'Invalid recall limit.');
    const anchored = [...new Set(options.anchoredSpaceIds)];
    for (const spaceId of anchored) {
      identifier(spaceId, 'space ID');
      requireRead(access, spaceId);
      if (!this.memory.getSpace(spaceId))
        throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    }
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const terms = [
      ...new Set(
        [...segmenter.segment(options.query)]
          .filter((item) => item.isWordLike)
          .map((item) => item.segment.toLowerCase())
      ),
    ].slice(0, 32);
    return this.repository.search(terms, anchored, access.readableSpaceIds, limit);
  }

  searchIndexStatus(access: MemoryAccess): L2IndexStatus {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Memory management is not allowed.');
    return this.repository.checkSearchIndex();
  }

  rebuildSearchIndex(access: MemoryAccess): void {
    validateAccess(access);
    if (!access.canManageSpaces)
      throw new MemoryError('ACCESS_DENIED', 'Memory management is not allowed.');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    this.repository.rebuildSearchIndex();
  }
}
