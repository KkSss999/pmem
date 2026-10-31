'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function load() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-decision-'));
  const original = path.join(__dirname, '..', 'dist');
  fs.cpSync(original, path.join(root, 'dist'), { recursive: true });
  return {
    root,
    JevMemoryChangeJudge: require(path.join(root, 'dist/other/models/jev')).JevMemoryChangeJudge,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const input = {
  current: {
    title: '5K personal best',
    summary: 'Running record',
    body: 'My 5K personal best is 27:12.',
    updatedAt: '2023-05-25T00:00:00.000Z',
  },
  changes: [
    {
      id: 'l1-current',
      content: 'My 5K personal best is now 25:50.',
      createdAt: '2023-05-27T00:00:00.000Z',
    },
  ],
};

test('Jev judge sends one typed decision request and parses its choice', async () => {
  const loaded = load();
  try {
    let request;
    const judge = new loaded.JevMemoryChangeJudge({
      apiKey: 'test-key',
      fetcher: async (url, init) => {
        request = { url, init, body: JSON.parse(init.body) };
        return new Response(
          JSON.stringify({
            model: 'typesafe/jev-1.14-20261014',
            answers: {
              change_0: {
                type: 'choice',
                choice: 'replacement',
                confidence: 0.98,
                probabilities: { replacement: 0.98, addition: 0.01, conflict: 0.01 },
              },
            },
            usage: { input_tokens: 512, output_tokens: 59, cost: 0.0000215 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const result = await judge.judge(input);
    assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer test-key');
    assert.equal(request.body.model, 'typesafe/jev-1.14');
    assert.equal(request.body.questions.change_0.type, 'choice');
    assert.deepEqual(result, [
      {
        changedL1Id: 'l1-current',
        type: 'replacement',
        confidence: 0.98,
        probabilities: { replacement: 0.98, addition: 0.01, conflict: 0.01 },
      },
    ]);
  } finally {
    loaded.cleanup();
  }
});

test('Jev judge rejects invalid output and does not hide request failures', async () => {
  const loaded = load();
  try {
    const invalid = new loaded.JevMemoryChangeJudge({
      apiKey: 'test-key',
      fetcher: async () =>
        new Response(
          JSON.stringify({ answers: { change_0: { type: 'choice', choice: 'maybe' } } }),
          {
            status: 200,
          }
        ),
    });
    await assert.rejects(
      () => invalid.judge(input),
      (error) => error?.code === 'JEV_OUTPUT_INVALID' && error.outcome === 'failed'
    );

    const failed = new loaded.JevMemoryChangeJudge({
      apiKey: 'test-key',
      fetcher: async () => new Response('unauthorized', { status: 401 }),
    });
    await assert.rejects(
      () => failed.judge(input),
      (error) => error?.code === 'JEV_HTTP_ERROR' && error.outcome === 'failed'
    );

    const unknown = new loaded.JevMemoryChangeJudge({
      apiKey: 'test-key',
      fetcher: async () => {
        throw new Error('timeout');
      },
    });
    await assert.rejects(
      () => unknown.judge(input),
      (error) => error?.code === 'JEV_REQUEST_FAILED' && error.outcome === 'unknown'
    );
  } finally {
    loaded.cleanup();
  }
});
