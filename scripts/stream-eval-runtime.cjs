'use strict';

// Shared plumbing for the explicit evaluation scripts. It drives the production
// stream pipeline (queue -> MemoryStreamAgent -> L1/L2/L3 apply) instead of the
// retired batch job API, so an evaluation measures the same path users run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULT_MODEL = {
  providerId: 'eval',
  modelId: 'deepseek/deepseek-v4.1-flash-ultrafast',
  api: 'openai-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  // The model is configured as a 1M-context window with a 256k output limit.
  contextWindow: 1_000_000,
  maxOutputTokens: 262_144,
};

function dist(name) {
  return require(path.join(ROOT, 'dist', name));
}

/** Shape one worker event into the evaluation trace record. */
function recordOf(event) {
  const { item, envelope, payload, skipped, error } = event;
  return {
    kind: item.kind,
    subjectId: item.subjectId,
    sourceHash: item.sourceHash,
    itemIds: item.id,
    envelope: envelope ?? null,
    payload,
    skipped: skipped === true,
    state: error ? 'failed' : 'done',
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null,
  };
}

function l1Ids(raw) {
  return raw
    .prepare('SELECT id FROM memory_l1 ORDER BY created_at, id')
    .all()
    .map((row) => row.id);
}

/**
 * One isolated evaluation runtime: its own database, its own stream session and a
 * single serial consumer. Callers own `close()`.
 */
async function createStreamEval(options) {
  const model = { ...DEFAULT_MODEL, ...(options.model ?? {}) };
  if (!options.apiKey) throw new Error('An API key is required.');
  const access = options.access ?? {
    readableSpaceIds: ['personal'],
    writableSpaceIds: ['personal'],
    canManageSpaces: true,
  };
  const workspaceId = options.workspaceId ?? 'pmem-eval';
  const scopeId = options.scopeId ?? 'personal';
  // A caller may keep the database (memory building) instead of using a temp dir.
  const root = options.directory
    ? (fs.mkdirSync(options.directory, { recursive: true }), options.directory)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-eval-'));
  const databasePath = path.join(root, options.databaseName ?? 'memory.sqlite');
  const { OwnedDatabase } = dist('db/database');
  const { assembleMemory } = dist('server/memory');
  const { assembleL1 } = dist('server/l1');
  const { assembleL1Maintenance } = dist('server/l1-maintenance');
  const { assembleL2 } = dist('server/l2');
  const { assembleL3 } = dist('server/l3');
  const { assembleMemoryStream } = dist('server/stream');
  const { MemoryStreamPipeline } = dist('agent/stream-pipeline');
  const { MemoryStreamWorker } = dist('agent/memory-worker');
  const { OpenAIMemoryStreamModel } = dist('agent/memory-model');

  const db = OwnedDatabase.create(databasePath);
  const memory = assembleMemory(db);
  const l1 = assembleL1(db);
  const maintenance = assembleL1Maintenance(db);
  const l2 = assembleL2(db, options.l2 ?? {});
  const l3 = assembleL3(db, options.l3 ?? {});
  const store = assembleMemoryStream(db);
  const pipeline = new MemoryStreamPipeline({
    queue: store.queue,
    workspaceId,
    scopeId,
    access,
    l1,
    maintenance,
    l2,
    l3,
  });
  const calls = [];
  const memoryModel = new OpenAIMemoryStreamModel({
    apiKey: options.apiKey,
    baseUrl: model.baseUrl,
    model: model.modelId,
    timeoutMs: options.timeoutMs ?? 180_000,
    maxOutputTokens: 32_768,
    onCall: (call) => calls.push(call),
  });
  let trace;
  const failureLog = [];
  const worker = new MemoryStreamWorker({
    queue: store.queue,
    handler: pipeline,
    model: memoryModel,
    workspaceId,
    scopeId,
    onItem: (event) => {
      trace?.push(event);
      if (event.error)
        failureLog.push({
          kind: event.item.kind,
          subjectId: event.item.subjectId,
          code: event.error.code,
          message: event.error.message,
        });
    },
  });

  const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
  const raw = new Database(databasePath, { readonly: true });

  return {
    root,
    databasePath,
    model,
    access,
    db,
    memory,
    l1,
    maintenance,
    l2,
    l3,
    queue: store.queue,
    pipeline,
    /** Append one L0 turn and queue its L1 extract item. */
    append(input) {
      const message = memory.appendL0({ spaceId: scopeId, ...input }, access).message;
      store.queue.enqueue({
        workspaceId,
        scopeId,
        kind: 'l1-extract',
        subjectId: message.id,
        sourceHash: l1.streamSourceHash(message.id, access),
      });
      return message;
    },
    /** Consume every pending item, including the follow-ups they enqueue. */
    async drain(maxItems = 400) {
      return worker.runUntilIdle(maxItems);
    },
    /** Queue one synthesis per L1 memory that no L2 cites yet, then return the count. */
    enqueueL2Coverage(limit = 500) {
      return pipeline.enqueueL2Coverage(limit);
    },
    /**
     * Consume every pending item while recording, per item, the envelope the model
     * was given, the payload it returned and what the service applied.
     */
    async runTraced(onRecord, maxItems = 400) {
      trace = [];
      let processed = 0;
      while (processed < maxItems) {
        trace = [];
        const ran = await worker.runNext();
        if (!ran) break;
        processed++;
        for (const event of trace) onRecord(recordOf(event));
      }
      trace = undefined;
      return processed;
    },
    /** Full readable memory state, for auditing what the run actually created. */
    dump() {
      const l0 = raw
        .prepare(
          'SELECT id, space_id AS spaceId, role, session_id AS sessionId, occurred_at AS occurredAt, content FROM memory_l0_messages ORDER BY sequence'
        )
        .all();
      const l1Rows = l1Ids(raw).map((id) => l1.getMemory(id, access));
      const l2Rows = l2
        .listMemories({ ownerSpaceId: scopeId, limit: 500 }, access)
        .map((memory) => l2.getMemory(memory.id, access));
      // L3 caps a single listing at 100 keywords.
      const l3Rows = l3.list([scopeId], access, { limit: 100 });
      return { l0, l1: l1Rows, l2: l2Rows, l3: l3Rows };
    },
    /** Errors with their messages, which the queue table only stores as codes. */
    failures() {
      return [...failureLog];
    },
    queueStates() {
      return raw
        .prepare(
          'SELECT kind, state, error_code AS errorCode, subject_id AS subjectId FROM memory_stream_queue WHERE workspace_id = ? ORDER BY id'
        )
        .all(workspaceId);
    },
    /** Every L1 memory whose evidence includes one of the given L0 messages. */
    memoriesFrom(sourceIds) {
      if (!sourceIds.length) return [];
      const placeholders = sourceIds.map(() => '?').join(', ');
      const ids = raw
        .prepare(
          `SELECT DISTINCT memory_id AS id FROM memory_l1_sources WHERE l0_id IN (${placeholders}) ORDER BY memory_id`
        )
        .all(...sourceIds)
        .map((row) => row.id);
      return ids.map((id) => l1.getMemory(id, access)).filter((memory) => memory !== undefined);
    },
    usage() {
      const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, ms: 0 };
      for (const call of calls) {
        totals.calls++;
        totals.ms += call.ms;
        const usage = call.usage ?? {};
        totals.input += Number(usage.prompt_tokens ?? usage.input ?? 0);
        totals.output += Number(usage.completion_tokens ?? usage.output ?? 0);
        totals.cacheRead += Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
        totals.reasoning += Number(usage.completion_tokens_details?.reasoning_tokens ?? 0);
      }
      return totals;
    },
    counts() {
      const read = (table) => raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
      return {
        l0: read('memory_l0_messages'),
        l1: read('memory_l1'),
        l2: read('memory_l2'),
        l3: read('memory_l3_keywords'),
      };
    },
    async close() {
      try {
        raw.close();
      } catch {}
      try {
        db.close();
      } catch {}
      if (!options.directory) fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

module.exports = { createStreamEval, ROOT, DEFAULT_MODEL };
