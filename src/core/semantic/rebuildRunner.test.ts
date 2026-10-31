import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { rebuildInChildProcess } from './rebuildRunner';

const JOB = {
  pmemPath: '/tmp/pmem-worker-test',
  spec: {
    model: 'test/e5',
    revision: 'r1',
    dtype: 'q8' as const,
    dimension: 3,
    cachePath: '/tmp/model',
  },
  mode: 'full' as const,
};

function workerFile(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-worker-'));
  const file = path.join(dir, 'worker.js');
  fs.writeFileSync(file, source);
  return file;
}

describe('semantic rebuild worker plumbing', () => {
  it('resolves with the worker result and passes the job as JSON argv', async () => {
    const file = workerFile(`
      const job = JSON.parse(process.argv[2]);
      process.send({ ok: true, result: { cardsSeen: 2, cardsExcluded: 0, chunksTotal: 5, mode: job.mode } }, () => process.disconnect());
    `);
    try {
      const result = await rebuildInChildProcess(file, JOB);
      assert.strictEqual(result.chunksTotal, 5);
      assert.strictEqual((result as unknown as { mode: string }).mode, 'full');
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('rejects with the worker error instead of a generic failure', async () => {
    const file = workerFile(
      `process.send({ ok: false, error: 'model cache corrupt' }, () => process.disconnect());`,
    );
    try {
      await assert.rejects(() => rebuildInChildProcess(file, JOB), /model cache corrupt/);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('rejects when the worker dies before reporting a result', async () => {
    const file = workerFile(`process.exit(3);`);
    try {
      await assert.rejects(
        () => rebuildInChildProcess(file, JOB),
        /exited before reporting a result/,
      );
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
