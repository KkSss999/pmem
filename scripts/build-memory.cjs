'use strict';

// Build memory only: ingest the dataset conversations and let the memory stream
// create L1/L2/L3, persisting one SQLite database per question. No answering and
// no judging. The API key is read from stdin and never written to disk.
//
//   printf '%s\n' "$KEY" | node scripts/build-memory.cjs \
//     --data=<longmemeval_oracle.json> --limit=10 --sample=first \
//     --base-url=... --model=... --out=temp/memory-oracle-10 --concurrency=5

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createStreamEval } = require('./stream-eval-runtime.cjs');

function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function numberOption(name, fallback, min, max) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid --${name}: ${value}.`);
  return value;
}

function parseDate(value) {
  const text = String(value ?? '');
  const match = text.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return undefined;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function selectQuestions(data, limit, offset, sample, type) {
  let selected = data;
  if (type) selected = selected.filter((item) => item.question_type === type);
  if (offset) selected = selected.slice(offset);
  if (sample === 'first') return selected.slice(0, limit);
  const groups = new Map();
  for (const item of selected) {
    const key = item.question_type ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort();
  const result = [];
  while (result.length < limit) {
    let added = false;
    for (const key of keys) {
      const group = groups.get(key);
      if (group.length) {
        result.push(group.shift());
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return result;
}

async function main(apiKey) {
  const dataPath = path.resolve(option('data', ''));
  if (!fs.existsSync(dataPath)) throw new Error(`Missing --data file: ${dataPath}`);
  const limit = numberOption('limit', 10, 1, 500);
  const offset = numberOption('offset', 0, 0, 499);
  const sample = option('sample', 'first');
  const type = option('type', '');
  const concurrency = numberOption('concurrency', 1, 1, 16);
  const itemTimeoutMs = numberOption('item-timeout', 120_000, 10_000, 600_000);
  const modelId = option('model', 'deepseek/deepseek-v4.1-flash-ultrafast');
  const baseUrl = option('base-url', 'https://api.deepseek.com/v1');
  const outDir = path.resolve(option('out', path.join('/tmp', `pmem-memory-${Date.now()}`)));
  if (!['first', 'stratified'].includes(sample)) throw new Error('Invalid --sample.');
  if (!apiKey) throw new Error('An API key is required on stdin.');

  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'summary.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const questions = selectQuestions(data, limit, offset, sample, type);
  if (!questions.length) throw new Error('No questions selected.');

  // Resume: a question is done when its dump and database both exist.
  const previous = new Map();
  if (fs.existsSync(summaryPath)) {
    try {
      for (const entry of JSON.parse(fs.readFileSync(summaryPath, 'utf8')).questions ?? [])
        if (entry && !entry.failure) previous.set(entry.index, entry);
    } catch {}
  }

  const startedAt = new Date().toISOString();
  const runStarted = performance.now();
  const results = new Map();

  function flush() {
    const ordered = [...results.values()].sort((left, right) => left.index - right.index);
    const aggregate = ordered.reduce(
      (totals, entry) => {
        totals.questions++;
        totals.l0 += entry.counts.l0;
        totals.l1 += entry.counts.l1;
        totals.l2 += entry.counts.l2;
        totals.l3 += entry.counts.l3;
        totals.calls += entry.usage.calls;
        totals.inputTokens += entry.usage.input;
        totals.outputTokens += entry.usage.output;
        totals.cacheReadTokens += entry.usage.cacheRead;
        totals.queueFailures += entry.queueFailures.length;
        totals.ms += entry.ms;
        if (entry.failure) totals.failed++;
        return totals;
      },
      {
        questions: 0,
        failed: 0,
        l0: 0,
        l1: 0,
        l2: 0,
        l3: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        queueFailures: 0,
        ms: 0,
      }
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          run: {
            dataPath,
            outDir,
            model: modelId,
            baseUrl,
            limit,
            offset,
            sample,
            type: type || null,
            concurrency,
            startedAt,
            finishedAt: new Date().toISOString(),
            elapsedMs: Math.round(performance.now() - runStarted),
          },
          aggregate,
          questions: ordered,
        },
        null,
        2
      )
    );
  }

  async function buildQuestion(index, question) {
    const questionId = question.question_id ?? `question-${index}`;
    const started = performance.now();
    const databaseName = `${questionId}.sqlite`;
    const databasePath = path.join(outDir, databaseName);
    const dumpPath = path.join(outDir, `${questionId}.json`);
    if (fs.existsSync(databasePath) && !fs.existsSync(dumpPath))
      fs.rmSync(databasePath, { force: true });

    const runtime = await createStreamEval({
      apiKey,
      model: { modelId, baseUrl },
      workspaceId: `memory-${questionId}`,
      directory: outDir,
      databaseName,
      timeoutMs: itemTimeoutMs,
    });
    const sessions = (question.haystack_sessions ?? [])
      .map((session, originalIndex) => ({
        session,
        originalIndex,
        sessionId: question.haystack_session_ids?.[originalIndex] ?? `session-${originalIndex}`,
        occurredAt: parseDate(question.haystack_dates?.[originalIndex]),
      }))
      .sort(
        (left, right) =>
          (left.occurredAt ? Date.parse(left.occurredAt) : 0) -
            (right.occurredAt ? Date.parse(right.occurredAt) : 0) ||
          left.originalIndex - right.originalIndex
      );
    try {
      let turns = 0;
      for (const entry of sessions) {
        for (const turn of entry.session) {
          runtime.append({
            role: turn.role === 'assistant' ? 'assistant' : 'user',
            content: String(turn.content ?? ''),
            source: 'longmemeval',
            sessionId: entry.sessionId,
            ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
          });
          turns++;
        }
        // Consume each session before ingesting the next one, like live capture.
        await runtime.drain();
      }
      // Batching can leave a change uncovered; give every uncovered L1 its own pass.
      let coverage = 0;
      for (let round = 0; round < 3; round++) {
        const queued = runtime.enqueueL2Coverage();
        if (!queued) break;
        coverage += queued;
        await runtime.drain();
      }
      const counts = runtime.counts();
      const queueFailures = runtime.queueStates().filter((item) => item.state !== 'done');
      const failureDetails = runtime.failures();
      const dump = runtime.dump();
      fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
      return {
        index,
        questionId,
        questionType: question.question_type,
        database: databaseName,
        dump: path.basename(dumpPath),
        sessions: sessions.length,
        turns,
        counts,
        coverageQueued: coverage,
        queueFailures,
        failureDetails,
        usage: runtime.usage(),
        ms: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        index,
        questionId,
        questionType: question.question_type,
        database: databaseName,
        sessions: sessions.length,
        failure: {
          name: error?.name ?? 'Error',
          code: error?.code ?? 'UNKNOWN',
          message: error?.message ?? String(error),
        },
        usage: runtime.usage(),
        ms: Math.round(performance.now() - started),
      };
    } finally {
      await runtime.close();
    }
  }

  const pending = questions
    .map((question, index) => ({ question, index }))
    .filter(({ index }) => !previous.has(index));
  for (const [index, entry] of previous) results.set(index, entry);
  process.stderr.write(
    `building ${pending.length} of ${questions.length} questions (${previous.size} reused) into ${outDir}\n`
  );
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const { question, index } = pending[cursor++];
      const result = await buildQuestion(index, question);
      results.set(index, result);
      flush();
      process.stderr.write(
        `${result.failure ? 'failed ' : 'built  '} ${result.questionId} ` +
          `l1=${result.counts?.l1 ?? 0} l2=${result.counts?.l2 ?? 0} l3=${result.counts?.l3 ?? 0} ` +
          `calls=${result.usage.calls} fails=${result.queueFailures?.length ?? 0} ` +
          `coverage=${result.coverageQueued ?? 0} ` +
          `${(result.ms / 1000).toFixed(0)}s\n`
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  flush();
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  process.stdout.write(JSON.stringify(summary.aggregate, null, 2) + '\n');
}

process.stdout.write('READY\n');
process.stdin.setEncoding('utf8');
process.stdin.once('data', (data) => {
  process.stdin.pause();
  main(data.trim()).then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(
        `Memory build failed: ${error?.code ?? error?.name}: ${error.message}\n`
      );
      process.exit(1);
    }
  );
});
