'use strict';

// Explicitly invoked evaluation; the API key is read from stdin, never recorded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { OwnedDatabase } = require('../dist/db/database');
const { assembleMemory } = require('../dist/server/memory');
const { assembleL1 } = require('../dist/server/l1');
const { OpenAIExtractionModel } = require('../dist/other/models/openai');
const suite = require('../tests/fixtures/l1-quality.json');

function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function main(apiKey) {
  const split = option('split', 'development');
  const api = option('api', 'chat');
  const rounds = Number(option('rounds', '1'));
  const concurrency = Number(option('concurrency', '2'));
  const caseId = option('case', '');
  const provider = option('provider', 'deepseek');
  const baseUrl = option('base-url', '');
  const modelName = option('model', '');
  if (
    !apiKey ||
    !['development', 'holdout'].includes(split) ||
    !['chat', 'responses'].includes(api) ||
    !['deepseek', 'openai'].includes(provider) ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 5 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4
  ) {
    throw new Error(
      'Provide an API key on stdin and valid split, api, provider, rounds and concurrency options.'
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-l1-eval-'));
  const db = OwnedDatabase.create(path.join(root, 'eval.sqlite'));
  try {
    const memory = assembleMemory(db);
    const l1 = assembleL1(db);
    const access = {
      readableSpaceIds: ['personal'],
      writableSpaceIds: ['personal'],
      canManageSpaces: false,
    };
    const work = [];
    const cases = suite.cases.filter(
      (entry) => entry.split === split && (!caseId || entry.id === caseId)
    );
    if (!cases.length) throw new Error('No evaluation cases selected.');
    for (const scenario of cases) {
      const sources = scenario.messages.map(
        (message) => memory.appendL0({ spaceId: 'personal', ...message }, access).message
      );
      for (let round = 1; round <= rounds; round++) {
        const id = `${scenario.id}-${round}`;
        l1.enqueue({ id, sourceIds: sources.map((source) => source.id) }, access);
        work.push({ id, scenario, sources, round });
      }
    }
    const results = [];
    let cursor = 0;
    async function worker() {
      while (cursor < work.length) {
        const task = work[cursor++];
        let usage;
        let httpStatus;
        let output;
        const fetcher = async (...args) => {
          const response = await fetch(...args);
          httpStatus = response.status;
          const payload = await response
            .clone()
            .json()
            .catch(() => ({}));
          usage = payload.usage;
          output =
            api === 'chat'
              ? payload.choices?.[0]?.message?.content
              : payload.output
                  ?.flatMap((item) => item.content ?? [])
                  .filter((item) => item.type === 'output_text')
                  .map((item) => item.text);
          return response;
        };
        const model = new OpenAIExtractionModel({
          provider,
          api,
          apiKey,
          ...(baseUrl ? { baseUrl } : {}),
          ...(modelName ? { model: modelName } : {}),
          timeoutMs: 120000,
          fetch: fetcher,
        });
        const start = performance.now();
        try {
          const job = await l1.run(task.id, model, access);
          const memories = l1.getJobMemories(job.id, access);
          const joined = memories.map((item) => item.content).join('\n');
          const checks = task.scenario.checks.map((pattern) => ({
            pattern,
            matched: new RegExp(pattern, 'iu').test(joined),
          }));
          const entries = memories.map((item) => ({
            content: item.content,
            abstraction: item.abstraction,
            cues: item.cues,
            sources: item.sourceIds.map(
              (id) => task.sources.findIndex((source) => source.id === id) + 1
            ),
          }));
          results.push({
            case: task.scenario.id,
            round: task.round,
            expectedMemory: task.scenario.expectMemory,
            status: job.state,
            count: memories.length,
            checks,
            entries,
            elapsedMs: Math.round(performance.now() - start),
            httpStatus,
            usage,
          });
        } catch (error) {
          const job = l1.getJob(task.id, access);
          results.push({
            case: task.scenario.id,
            round: task.round,
            expectedMemory: task.scenario.expectMemory,
            status: job?.state ?? 'error',
            failureCode: job?.failureCode ?? error.code ?? 'UNKNOWN',
            ...(job?.failureCode === 'MODEL_OUTPUT_INVALID' ? { output } : {}),
            elapsedMs: Math.round(performance.now() - start),
            httpStatus,
            usage,
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
    results.sort((a, b) => a.case.localeCompare(b.case) || a.round - b.round);
    for (const result of results) process.stdout.write(JSON.stringify(result) + '\n');
    const positives = results.filter((result) => result.expectedMemory);
    const negatives = results.filter((result) => !result.expectedMemory);
    const successful = results.filter((result) => result.status === 'succeeded');
    process.stdout.write(
      JSON.stringify({
        summary: {
          split,
          api,
          rounds,
          total: results.length,
          succeeded: successful.length,
          positiveEmpty: positives.filter(
            (result) => result.status === 'succeeded' && result.count === 0
          ).length,
          positiveWithAllChecks: positives.filter(
            (result) =>
              result.status === 'succeeded' &&
              result.count > 0 &&
              result.checks.every((check) => check.matched)
          ).length,
          positiveTotal: positives.length,
          negativeNonempty: negatives.filter(
            (result) => result.status === 'succeeded' && result.count > 0
          ).length,
          negativeTotal: negatives.length,
        },
      }) + '\n'
    );
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

process.stdout.write('READY\n');
process.stdin.setEncoding('utf8');
process.stdin.once('data', (data) => {
  process.stdin.pause();
  main(data.trim()).then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`Evaluation failed: ${error.code ?? error.name}\n`);
      process.exit(1);
    }
  );
});
