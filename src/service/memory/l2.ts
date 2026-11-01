import { createHash, randomUUID } from 'node:crypto';
import {
  MEMORY_CHANGE_TYPES,
  MemoryDecisionError,
  type MemoryChangeJudge,
} from '../../domain/memory/decision';
import type { L1Memory } from '../../domain/memory/l1';
import {
  L2ModelError,
  type L2Candidate,
  type L2Change,
  type L2ChangeKind,
  type L2Draft,
  type L2GenerationChange,
  type L2GenerationModel,
  type L2IndexStatus,
  type L2Job,
  type L2Memory,
} from '../../domain/memory/l2';
import { MemoryError, type MemoryAccess } from '../../domain/memory/types';
import { identifier, requireRead, requireWrite, validateAccess } from './index';
import type { MemoryRepository } from './ports';
import type { L1Repository } from './l1-ports';
import type { L2Repository } from './l2-ports';

const MAX_TITLE = 200;
const MAX_SUMMARY = 1000;
const MAX_BODY = 20_000;
const CHANGE_KINDS: readonly L2ChangeKind[] = [
  'created',
  'content_changed',
  'scope_changed',
  'merged',
  'removed',
];

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

  const changeIds = new Set(changes.map((item) => item.change.l1Id));
  const candidateById = new Map(candidates.map((item) => [item.memory.id, item]));
  const allLinkedIds = new Set(
    candidates.flatMap((candidate) => candidate.memory.l1Ids.map((id) => id))
  );
  const updateIds = new Set<string>();
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
  const covered = new Set(results.flatMap((result) => result.l1Ids));
  for (const change of changes) {
    if (!covered.has(change.change.l1Id) && !uncoveredIds.has(change.change.l1Id))
      throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A changed L1 is not covered.');
  }
  if ([...uncoveredIds].some((id) => covered.has(id)))
    throw new MemoryError('L2_MODEL_OUTPUT_INVALID', 'A changed L1 is both covered and uncovered.');
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
  l1Id: string;
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

  recordChange(input: { l1Id: string; kind: L2ChangeKind }, access: MemoryAccess): L2Change {
    if (!input || typeof input !== 'object')
      throw new MemoryError('INVALID_INPUT', 'A change is required.');
    validateAccess(access);
    identifier(input.l1Id, 'L1 ID');
    if (!CHANGE_KINDS.includes(input.kind))
      throw new MemoryError('INVALID_INPUT', 'Invalid L2 change kind.');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    const memory = this.l1.getMemory(input.l1Id, access.readableSpaceIds);
    if (!memory) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
    requireRead(access, memory.spaceId);
    requireWrite(access, memory.spaceId);
    if (memory.maintenanceStatus !== 'complete')
      throw new MemoryError('INVALID_INPUT', 'L1 maintenance is not complete.');
    if (!memory.sourcesComplete)
      throw new MemoryError('INVALID_INPUT', 'L1 sources are incomplete.');
    return this.repository.recordChange({
      id: randomUUID(),
      l1Id: memory.id,
      ownerSpaceId: memory.spaceId,
      kind: input.kind,
      l1Hash: l1Hash(memory),
      state: 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  listChanges(options: { ownerSpaceId: string; limit?: number }, access: MemoryAccess): L2Change[] {
    if (!options || typeof options !== 'object')
      throw new MemoryError('INVALID_INPUT', 'List options are required.');
    identifier(options.ownerSpaceId, 'space ID');
    requireRead(access, options.ownerSpaceId);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new MemoryError('INVALID_INPUT', 'Invalid pagination limit.');
    return this.repository.listChanges(options.ownerSpaceId, access.readableSpaceIds, limit);
  }

  enqueue(input: QueueL2Input, access: MemoryAccess): L2Job {
    if (!input || typeof input !== 'object')
      throw new MemoryError('INVALID_INPUT', 'An L2 job is required.');
    validateAccess(access);
    identifier(input.id, 'job ID');
    identifier(input.ownerSpaceId, 'space ID');
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    requireRead(access, input.ownerSpaceId);
    requireWrite(access, input.ownerSpaceId);
    if (!this.memory.getSpace(input.ownerSpaceId))
      throw new MemoryError('SPACE_NOT_FOUND', 'Space does not exist.');
    const now = new Date().toISOString();
    return this.repository.createJob({
      id: input.id,
      ownerSpaceId: input.ownerSpaceId,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  getJob(id: string, access: MemoryAccess): L2Job | undefined {
    identifier(id, 'job ID');
    validateAccess(access);
    return this.repository.getJob(id, access.readableSpaceIds);
  }

  retry(id: string, access: MemoryAccess): L2Job {
    identifier(id, 'job ID');
    validateAccess(access);
    const job = this.repository.getJob(id, access.readableSpaceIds);
    if (!job) throw new MemoryError('JOB_NOT_FOUND', 'L2 job not found.');
    requireWrite(access, job.ownerSpaceId);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (job.state !== 'failed' && job.state !== 'unknown' && job.state !== 'partial')
      throw new MemoryError('JOB_NOT_PENDING', 'L2 job is not retryable.');
    for (const change of this.repository.listChanges(
      job.ownerSpaceId,
      access.readableSpaceIds,
      1000
    )) {
      if (change.jobId !== id || change.state !== 'failed') continue;
      const memory = this.l1.getMemory(change.l1Id, access.readableSpaceIds);
      if (memory && memory.maintenanceStatus === 'complete' && memory.sourcesComplete)
        this.repository.refreshChangeHash(change.id, l1Hash(memory));
    }
    const result = this.repository.retryJob(id, job.state, new Date().toISOString());
    if (!result) throw new MemoryError('JOB_NOT_PENDING', 'L2 job changed before retry.');
    return result;
  }

  streamSourceHash(l1Id: string, access: MemoryAccess): string {
    identifier(l1Id, 'L1 ID');
    validateAccess(access);
    const memory = this.l1.getMemory(l1Id, access.readableSpaceIds);
    if (!memory) throw new MemoryError('JOB_NOT_FOUND', 'L1 memory not found.');
    return l1Hash(memory);
  }

  async prepareStream(l1Id: string, access: MemoryAccess): Promise<L2StreamPreparation> {
    identifier(l1Id, 'L1 ID');
    validateAccess(access);
    const memory = this.l1.getMemory(l1Id, access.readableSpaceIds);
    if (!memory || memory.maintenanceStatus !== 'complete' || !memory.sourcesComplete)
      throw new MemoryError('INVALID_INPUT', 'L1 memory is not ready for L2 streaming.');
    requireRead(access, memory.spaceId);
    const ownerSpaceId = memory.spaceId;
    const now = new Date().toISOString();
    const change: L2Change = {
      id: `stream:${l1Id}`,
      l1Id,
      ownerSpaceId,
      kind: 'created',
      l1Hash: l1Hash(memory),
      state: 'pending',
      createdAt: now,
    };
    const loaded: L2GenerationChange[] = [{ change, memory }];
    const linked = this.repository.listLinkedCandidates(
      ownerSpaceId,
      [l1Id],
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
    const replacementByCandidate = new Map<string, ReadonlySet<string>>();
    let candidatesForModel = candidates;
    if (this.options.judge && candidates.length) {
      const judged: L2Candidate[] = [];
      try {
        for (const candidate of candidates) {
          const judgments = await this.options.judge.judge({
            current: {
              title: candidate.memory.title,
              summary: candidate.memory.summary,
              body: candidate.memory.body,
              updatedAt: candidate.memory.updatedAt,
            },
            changes: [{ id: l1Id, content: memory.content, createdAt: memory.createdAt }],
          });
          if (!Array.isArray(judgments) || judgments.length !== 1)
            throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'Incomplete judgment.');
          const judgment = judgments[0];
          if (
            !judgment ||
            judgment.changedL1Id !== l1Id ||
            !MEMORY_CHANGE_TYPES.includes(judgment.type)
          )
            throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'Invalid judgment.');
          if (judgment.type === 'replacement')
            replacementByCandidate.set(candidate.memory.id, new Set([l1Id]));
          else judged.push(candidate);
        }
        candidatesForModel = judged;
      } catch (cause) {
        throw new MemoryError('L2_DECISION_FAILED', 'Memory change judgment failed.', { cause });
      }
    }
    return {
      l1Id,
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
    const memory = this.l1.getMemory(preparation.l1Id, access.readableSpaceIds);
    if (!memory || l1Hash(memory) !== l1Hash(preparation.loaded[0].memory))
      throw new MemoryError('L2_STALE_INPUT', 'The L1 source changed before stream commit.');
    const proposal = validateProposal(raw, preparation.loaded, preparation.candidatesForModel);
    const known = new Map<string, L1Memory>();
    known.set(memory.id, memory);
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
      const syntheticJob = {
        id: `stream:${preparation.l1Id}`,
        ownerSpaceId: preparation.ownerSpaceId,
        state: 'running' as const,
        createdAt: now,
        updatedAt: now,
      };
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
          const applied = this.repository.applyUpdate(syntheticJob, {
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
        const created = this.repository.applyCreate(syntheticJob, {
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

  async run(id: string, model: L2GenerationModel, access: MemoryAccess): Promise<L2Job> {
    identifier(id, 'job ID');
    validateAccess(access);
    if (this.readOnly) throw new MemoryError('READ_ONLY', 'Memory is read-only.');
    if (!model || typeof model.generate !== 'function')
      throw new MemoryError('INVALID_INPUT', 'An L2 generation model is required.');
    const job = this.repository.getJob(id, access.readableSpaceIds);
    if (!job) throw new MemoryError('JOB_NOT_FOUND', 'L2 job not found.');
    requireWrite(access, job.ownerSpaceId);
    const claimed = this.repository.claim(
      id,
      access.writableSpaceIds,
      randomUUID(),
      new Date().toISOString()
    );
    if (!claimed) throw new MemoryError('JOB_NOT_PENDING', 'L2 job is not pending.');
    const { changes } = claimed;
    const now = new Date().toISOString();
    if (typeof model.promptVersion === 'string' && model.promptVersion)
      this.repository.setPromptVersion(id, claimed.job.claimToken!, model.promptVersion, now);
    const changeIds = changes.map((change) => change.id);

    const loaded: L2GenerationChange[] = [];
    for (const change of changes) {
      const memory = this.l1.getMemory(change.l1Id, access.readableSpaceIds);
      if (!memory || memory.maintenanceStatus !== 'complete' || l1Hash(memory) !== change.l1Hash) {
        this.repository.finishChanges(changeIds, 'failed', id, 'L2_STALE_INPUT', now);
        this.repository.finishJob(id, claimed.job.claimToken!, 'failed', 'L2_STALE_INPUT', now);
        throw new MemoryError('L2_STALE_INPUT', 'An L1 source changed before generation.');
      }
      requireRead(access, memory.spaceId);
      loaded.push({ change, memory });
    }

    const linked = this.repository.listLinkedCandidates(
      job.ownerSpaceId,
      changes.map((change) => change.l1Id),
      access.readableSpaceIds,
      10
    );
    let searched: L2Memory[] = [];
    try {
      searched = this.repository.search(
        candidateTerms(loaded),
        [job.ownerSpaceId],
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
      searched = this.repository.listCandidates(job.ownerSpaceId, access.readableSpaceIds, 10);
    }
    const candidates: L2Candidate[] = [];
    const byId = new Map<string, L2Memory>();
    for (const memory of [...linked, ...searched]) byId.set(memory.id, memory);
    for (const memory of [...byId.values()].slice(0, 10)) {
      const evidence = memory.l1Ids
        .map((l1Id) => this.l1.getMemory(l1Id, access.readableSpaceIds))
        .filter((item): item is L1Memory => item !== undefined);
      if (evidence.length !== memory.l1Ids.length) continue;
      candidates.push({ memory, evidence });
    }

    const replacementByCandidate = new Map<string, ReadonlySet<string>>();
    let candidatesForModel = candidates;
    if (this.options.judge && candidates.length) {
      const judged: L2Candidate[] = [];
      try {
        for (const candidate of candidates) {
          const judgments = await this.options.judge.judge({
            current: {
              title: candidate.memory.title,
              summary: candidate.memory.summary,
              body: candidate.memory.body,
              updatedAt: candidate.memory.updatedAt,
            },
            changes: loaded.map((item) => ({
              id: item.change.l1Id,
              content: item.memory.content,
              createdAt: item.memory.createdAt,
            })),
          });
          if (!Array.isArray(judgments) || judgments.length !== loaded.length)
            throw new MemoryDecisionError(
              'JEV_OUTPUT_INVALID',
              'failed',
              'The memory change judge returned incomplete judgments.'
            );
          const expected = new Set(loaded.map((item) => item.change.l1Id));
          const seen = new Set<string>();
          const replaced = new Set<string>();
          for (const judgment of judgments) {
            if (
              !judgment ||
              typeof judgment.changedL1Id !== 'string' ||
              !expected.has(judgment.changedL1Id) ||
              seen.has(judgment.changedL1Id) ||
              !MEMORY_CHANGE_TYPES.includes(judgment.type)
            )
              throw new MemoryDecisionError(
                'JEV_OUTPUT_INVALID',
                'failed',
                'The memory change judge returned an invalid judgment.'
              );
            seen.add(judgment.changedL1Id);
            if (judgment.type === 'replacement') replaced.add(judgment.changedL1Id);
          }
          if (replaced.size) replacementByCandidate.set(candidate.memory.id, replaced);
          else judged.push(candidate);
        }
        candidatesForModel = judged;
      } catch (cause) {
        const outcome = cause instanceof MemoryDecisionError ? cause.outcome : 'unknown';
        const failure = cause instanceof MemoryDecisionError ? cause.code : 'L2_DECISION_FAILED';
        try {
          this.repository.finishChanges(changeIds, 'failed', id, failure, now);
          this.repository.finishJob(
            id,
            claimed.job.claimToken!,
            outcome === 'unknown' ? 'unknown' : 'failed',
            failure,
            now
          );
        } catch (statusError) {
          throw new AggregateError(
            [cause, statusError],
            'The memory change judge failed and status could not be persisted.'
          );
        }
        throw new MemoryError('L2_DECISION_FAILED', 'Memory change judgment failed.', { cause });
      }
    }

    let proposal: Proposal;
    let raw: unknown;
    try {
      raw = await model.generate({
        ownerSpaceId: job.ownerSpaceId,
        changes: loaded,
        candidates: candidatesForModel,
        now,
      });
      proposal = validateProposal(raw, loaded, candidatesForModel);
    } catch (cause) {
      const state =
        cause instanceof L2ModelError
          ? cause.outcome
          : cause instanceof MemoryError && cause.code === 'L2_MODEL_OUTPUT_INVALID'
            ? 'failed'
            : 'unknown';
      const code =
        cause instanceof L2ModelError
          ? cause.code
          : cause instanceof MemoryError
            ? cause.code
            : 'L2_MODEL_OUTCOME_UNKNOWN';
      try {
        this.repository.finishChanges(changeIds, 'failed', id, code, now);
        this.repository.finishJob(id, claimed.job.claimToken!, state, code, now);
      } catch (statusError) {
        throw new AggregateError(
          [cause, statusError],
          'L2 generation failed and status could not be persisted.'
        );
      }
      throw new MemoryError('L2_MODEL_FAILED', `L2 generation ${state}.`, { cause });
    }

    const known = new Map<string, L1Memory>();
    for (const item of loaded) known.set(item.memory.id, item.memory);
    for (const candidate of candidates)
      for (const evidence of candidate.evidence) known.set(evidence.id, evidence);
    const candidateById = new Map(candidatesForModel.map((item) => [item.memory.id, item]));
    const replacementTarget = new Map<string, string>();

    const covered = new Set<string>();
    const failed = new Map<string, string>();
    let committed = 0;
    let skipped = 0;
    const l2Ids: string[] = [];
    let failedCount = 0;
    let firstFailure: string | undefined;

    for (const [index, draft] of proposal.results.entries()) {
      try {
        const used = draft.l1Ids.map((l1Id) => {
          const memory = known.get(l1Id);
          if (!memory) throw new MemoryError('L2_STALE_INPUT', 'An L1 source is unavailable.');
          const current = this.l1.getMemory(l1Id, access.readableSpaceIds);
          if (!current || l1Hash(current) !== l1Hash(memory))
            throw new MemoryError('L2_STALE_INPUT', 'An L1 source changed before commit.');
          requireRead(access, current.spaceId);
          return current;
        });
        if (used.some((memory) => !memory.sourcesComplete))
          throw new MemoryError('L2_STALE_INPUT', 'An L1 source is incomplete.');
        const scope = intersection(used.map(l1Scope));
        if (!scope.includes(job.ownerSpaceId))
          throw new MemoryError('L2_SCOPE_EMPTY', 'No common scope.');
        if (scope.some((spaceId) => !access.readableSpaceIds.includes(spaceId)))
          throw new MemoryError('L2_SCOPE_EMPTY', 'A result scope is not readable.');
        const relatedSpaceIds = scope.filter((spaceId) => spaceId !== job.ownerSpaceId);
        const sourceIds = [...new Set(used.flatMap((memory) => memory.sourceIds))].sort();
        const contentHash = l2Hash(draft);
        const generationId = randomUUID();
        const candidate = draft.l2Id ? candidateById.get(draft.l2Id) : undefined;
        if (draft.action === 'update') {
          if (!candidate)
            throw new MemoryError('L2_STALE_INPUT', 'The L2 candidate is unavailable.');
          const current = this.repository.getMemory(candidate.memory.id, access.readableSpaceIds);
          if (
            !current ||
            current.contentHash !== candidate.memory.contentHash ||
            JSON.stringify(current.l1Ids) !== JSON.stringify(candidate.memory.l1Ids)
          )
            throw new MemoryError('L2_STALE_INPUT', 'The L2 candidate changed before commit.');
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
            this.repository.recordResult(
              id,
              index,
              'skipped',
              'update',
              current.id,
              undefined,
              now
            );
            skipped++;
            for (const [oldId, triggerIds] of replacementByCandidate)
              if (!replacementTarget.has(oldId) && draft.l1Ids.some((l1Id) => triggerIds.has(l1Id)))
                replacementTarget.set(oldId, current.id);
          } else {
            const applied = this.repository.applyUpdate(job, {
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
            this.repository.recordResult(
              id,
              index,
              'committed',
              'update',
              current.id,
              undefined,
              now
            );
            committed++;
            for (const [oldId, triggerIds] of replacementByCandidate)
              if (!replacementTarget.has(oldId) && draft.l1Ids.some((l1Id) => triggerIds.has(l1Id)))
                replacementTarget.set(oldId, applied.id);
          }
        } else {
          const created = this.repository.applyCreate(job, {
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
          this.repository.recordResult(
            id,
            index,
            'committed',
            'create',
            created.id,
            undefined,
            now
          );
          committed++;
          for (const [oldId, triggerIds] of replacementByCandidate)
            if (!replacementTarget.has(oldId) && draft.l1Ids.some((l1Id) => triggerIds.has(l1Id)))
              replacementTarget.set(oldId, created.id);
        }
        for (const l1Id of draft.l1Ids) covered.add(l1Id);
      } catch (cause) {
        const code = cause instanceof MemoryError ? cause.code : 'L2_COMMIT_FAILED';
        this.repository.recordResult(id, index, 'failed', draft.action, draft.l2Id, code, now);
        for (const l1Id of draft.l1Ids) if (!covered.has(l1Id)) failed.set(l1Id, code);
        failedCount++;
        firstFailure ??= code;
      }
    }

    for (const [oldId, newId] of replacementTarget) {
      const candidate = candidates.find((item) => item.memory.id === oldId);
      if (!candidate || candidate.memory.id === newId) continue;
      try {
        this.repository.applySupersede(oldId, newId, candidate.memory.contentHash, now);
      } catch (cause) {
        const code = cause instanceof MemoryError ? cause.code : 'L2_SUPERSEDE_FAILED';
        failedCount++;
        firstFailure ??= code;
      }
    }
    for (const oldId of replacementByCandidate.keys())
      if (!replacementTarget.has(oldId)) {
        failedCount++;
        firstFailure ??= 'L2_SUPERSEDE_UNRESOLVED';
      }

    const uncovered = new Map(proposal.uncovered.map((item) => [item.l1Id, item.reason]));
    const processedIds = changes.map((change) => change.l1Id).filter((l1Id) => covered.has(l1Id));
    const uncoveredIds = changes
      .map((change) => change.l1Id)
      .filter((l1Id) => !covered.has(l1Id) && uncovered.has(l1Id));
    const failedIds = changes
      .map((change) => change.l1Id)
      .filter((l1Id) => !covered.has(l1Id) && !uncovered.has(l1Id));
    const changeIdByL1 = new Map(changes.map((change) => [change.l1Id, change.id]));
    this.repository.finishChanges(
      processedIds.map((id) => changeIdByL1.get(id)!),
      'processed',
      id,
      undefined,
      now
    );
    this.repository.finishChanges(
      uncoveredIds.map((id) => changeIdByL1.get(id)!),
      'uncovered',
      id,
      uncoveredIds.map((id) => uncovered.get(id)).join('; ') || undefined,
      now
    );
    this.repository.finishChanges(
      failedIds.map((id) => changeIdByL1.get(id)!),
      'failed',
      id,
      failedIds.map((id) => failed.get(id) ?? 'L2_FAILED').join('; ') || undefined,
      now
    );

    const state =
      failedCount > 0 && committed + skipped > 0
        ? 'partial'
        : failedCount > 0
          ? 'failed'
          : 'succeeded';
    this.repository.finishJob(
      id,
      claimed.job.claimToken!,
      state,
      state === 'partial' ? 'L2_PARTIAL' : firstFailure,
      now
    );
    return this.repository.getJob(id, access.readableSpaceIds)!;
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
