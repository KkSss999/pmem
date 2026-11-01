'use strict';

// Explicit L1 extraction evaluation over the production stream pipeline.
// The API key is read from stdin and never written to disk.

const { performance } = require('node:perf_hooks');
const { createStreamEval } = require('./stream-eval-runtime.cjs');
const suite = require('../tests/fixtures/l1-quality.json');

function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

async function evaluateCase({ scenario, round, apiKey, model }) {
  const runtime = await createStreamEval({
    apiKey,
    model,
    workspaceId: `l1-eval-${scenario.id}-${round}`,
  });
  const started = performance.now();
  try {
    const messages = scenario.messages.map((message) =>
      runtime.append({
        role: message.role,
        content: String(message.content ?? ''),
        ...(message.occurredAt ? { occurredAt: message.occurredAt } : {}),
      })
    );
    await runtime.drain();
    const memories = runtime.memoriesFrom(messages.map((message) => message.id));
    const joined = memories.map((memory) => memory.content).join('\n');
    const checks = scenario.checks.map((pattern) => ({
      pattern,
      matched: new RegExp(pattern, 'iu').test(joined),
    }));
    // This evaluation measures L1 extraction. L2/L3 items still run (they are the
    // production path) but their failures are reported separately, not as L1 failures.
    const states = runtime.queueStates();
    const failed = states.filter((item) => item.kind === 'l1-extract' && item.state !== 'done');
    const downstream = states.filter((item) => item.kind !== 'l1-extract' && item.state !== 'done');
    return {
      case: scenario.id,
      round,
      expectedMemory: scenario.expectMemory,
      status: failed.length ? 'failed' : 'succeeded',
      ...(failed.length ? { queue: failed } : {}),
      ...(downstream.length ? { downstream } : {}),
      messages: messages.length,
      count: memories.length,
      checks,
      entries: memories.map((memory) => ({
        content: memory.content,
        abstraction: memory.abstraction,
        cues: memory.cues,
        sources: memory.sourceIds.map(
          (id) => messages.findIndex((message) => message.id === id) + 1
        ),
      })),
      elapsedMs: Math.round(performance.now() - started),
      usage: runtime.usage(),
    };
  } catch (error) {
    return {
      case: scenario.id,
      round,
      expectedMemory: scenario.expectMemory,
      status: 'error',
      failureCode: error?.code ?? error?.name ?? 'UNKNOWN',
      elapsedMs: Math.round(performance.now() - started),
      usage: runtime.usage(),
    };
  } finally {
    await runtime.close();
  }
}

async function main(apiKey) {
  const split = option('split', 'development');
  const rounds = Number(option('rounds', '1'));
  const concurrency = Number(option('concurrency', '2'));
  const caseId = option('case', '');
  const providerId = option('provider-id', 'eval');
  const api = option('api', 'openai-completions');
  const modelId = option('model', 'deepseek/deepseek-v4.1-flash-ultrafast');
  const baseUrl = option('base-url', 'https://api.deepseek.com/v1');
  if (
    !apiKey ||
    !['development', 'holdout'].includes(split) ||
    !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(api) ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 5 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4
  ) {
    throw new Error(
      'Provide an API key on stdin and valid split, api, rounds and concurrency options.'
    );
  }
  const model = { providerId, modelId, api, baseUrl };
  const cases = suite.cases.filter(
    (entry) => entry.split === split && (!caseId || entry.id === caseId)
  );
  if (!cases.length) throw new Error('No evaluation cases selected.');
  const work = [];
  for (const scenario of cases)
    for (let round = 1; round <= rounds; round++) work.push({ scenario, round });

  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const task = work[cursor++];
      const result = await evaluateCase({ ...task, apiKey, model });
      results.push(result);
      process.stdout.write(JSON.stringify(result) + '\n');
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  results.sort((a, b) => a.case.localeCompare(b.case) || a.round - b.round);

  const positives = results.filter((result) => result.expectedMemory);
  const negatives = results.filter((result) => !result.expectedMemory);
  const successful = results.filter((result) => result.status === 'succeeded');
  process.stdout.write(
    JSON.stringify({
      summary: {
        split,
        api,
        model: modelId,
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
}

process.stdout.write('READY\n');
process.stdin.setEncoding('utf8');
process.stdin.once('data', (data) => {
  process.stdin.pause();
  main(data.trim()).then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`Evaluation failed: ${error.code ?? error.name}: ${error.message}\n`);
      process.exit(1);
    }
  );
});
