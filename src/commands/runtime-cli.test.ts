import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { askCommand } from './ask';
import { captureCommand } from './capture';
import { statusCommand } from './status';
import { relationsQuery } from './relations';
import { Pmem } from '../runtime';

const originalOpen = Pmem.open;
const originalCwd = process.cwd();

function makePmemProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-runtime-cli-'));
  fs.mkdirSync(path.join(root, '.pmem'), { recursive: true });
  fs.writeFileSync(path.join(root, '.pmem', 'pmem.db'), '', 'utf8');
  return root;
}

async function withCapturedConsole(fn: () => void | Promise<void>): Promise<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { stdout.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { stderr.push(args.join(' ')); };
  try {
    await fn();
    return { stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe('read/query CLI commands use Pmem Runtime', () => {
  afterEach(() => {
    (Pmem as any).open = originalOpen;
    process.chdir(originalCwd);
  });

  it('askCommand routes through Pmem.open().ask() and preserves JSON envelope', async () => {
    const root = makePmemProject();
    process.chdir(root);
    const calls: string[] = [];
    (Pmem as any).open = async (opts: { root: string }) => {
      calls.push(`open:${opts.root}`);
      return {
        ask: async (query: string, opts: { explain?: boolean; limit?: number }) => {
          calls.push(`ask:${query}:${opts.explain}:${opts.limit}`);
          return {
            query,
            matched: [],
            recommended_files: [],
            evidence_paths: [],
          };
        },
        close: async () => { calls.push('close'); },
      };
    };

    const out = await withCapturedConsole(() => askCommand('runtime api', 'json', { explain: true, limit: 3 }));
    const json = JSON.parse(out.stdout.join('\n'));

    assert.deepStrictEqual(calls, [`open:${process.cwd()}`, 'ask:runtime api:true:3', 'close']);
    assert.strictEqual(json.query, 'runtime api');
    assert.strictEqual(json.message, 'No matching memory cards found.');
    assert.deepStrictEqual(json.next_steps, [
      'Try a different query keyword',
      'Run `pmem recall` for full project context',
      'Check that cards have relevant aliases and tags',
    ]);
  });

  it('captureCommand routes through Pmem.capture(), preserves options/output, and closes Runtime', async () => {
    const root = makePmemProject();
    process.chdir(root);
    const cwd = process.cwd();
    const calls: string[] = [];
    (Pmem as any).open = async (opts: { root: string }) => {
      calls.push(`open:${opts.root}`);
      return {
        capture: async (summary: string, opts: { auto?: boolean; summary?: string; next?: string; full?: boolean; force?: boolean }) => {
          calls.push(`capture:${summary}:${opts.auto}:${opts.summary}:${opts.next}:${opts.full}:${opts.force}`);
          return {
            success: true,
            message: 'Memory sync and update completed successfully.',
            tracePath: path.join(cwd, '.pmem', 'traces', '2026-07-22-001.md'),
          };
        },
        close: async () => { calls.push('close'); },
      };
    };

    const out = await withCapturedConsole(() => captureCommand({
      auto: true,
      summary: 'runtime capture',
      next: 'continue',
      full: true,
      force: true,
    }));

    assert.deepStrictEqual(calls, [
      `open:${cwd}`,
      'capture:runtime capture:true:runtime capture:continue:true:true',
      'close',
    ]);
    assert.deepStrictEqual(out.stdout, [
      'Memory sync and update completed successfully.',
      `Trace card written: ${path.join('.pmem', 'traces', '2026-07-22-001.md')}`,
    ]);
    assert.deepStrictEqual(out.stderr, []);
  });

  it('captureCommand closes Runtime when capture throws', async () => {
    const root = makePmemProject();
    process.chdir(root);
    const calls: string[] = [];
    (Pmem as any).open = async () => ({
      capture: async () => {
        calls.push('capture');
        throw new Error('capture failed');
      },
      close: async () => { calls.push('close'); },
    });

    await assert.rejects(() => captureCommand({ summary: 'failure' }), /capture failed/);
    assert.deepStrictEqual(calls, ['capture', 'close']);
  });

  it('statusCommand prints the Runtime status result without changing JSON shape', async () => {
    const root = makePmemProject();
    process.chdir(root);
    const expected = {
      checked_at: '2026-07-22T00:00:00.000Z',
      source: 'git',
      changes: [{ path: 'src/index.ts', status: 'M', related_cards: [] }],
      affected_cards: [],
      needs_rebuild: false,
      state: 'no_changes',
      suggested_action: null,
    };
    const calls: string[] = [];
    (Pmem as any).open = async () => ({
      status: async (opts: { since?: string }) => {
        calls.push(`status:${opts.since}`);
        return expected;
      },
      close: async () => { calls.push('close'); },
    });

    const out = await withCapturedConsole(() => statusCommand({ since: '2026-07-21T00:00:00.000Z', format: 'json' }));

    assert.deepStrictEqual(calls, ['status:2026-07-21T00:00:00.000Z', 'close']);
    assert.deepStrictEqual(JSON.parse(out.stdout.join('\n')), expected);
  });

  it('relationsQuery adapts Runtime related() output to the legacy relations shape', async () => {
    const root = makePmemProject();
    const calls: string[] = [];
    (Pmem as any).open = async (opts: { root: string }) => {
      calls.push(`open:${opts.root}`);
      return {
        related: async (id: string, opts: { type?: string; source?: string }) => {
          calls.push(`related:${id}:${opts.type}:${opts.source}`);
          return {
            card: { id, type: 'module', title: 'Hub', status: 'active', file: '.pmem/modules/hub.md' },
            total_edges: 3,
            high_confidence: [],
            needs_review: [],
            edges_by_type: {
              depends_on: [
                { direction: 'out', target_id: 'module.A', target_title: 'A', target_type: 'module', target_status: 'active', source: 'explicit', confidence: 1 },
                { direction: 'in', target_id: 'module.B', target_title: 'B', target_type: 'module', target_status: 'active', source: 'mention', confidence: 0.4 },
              ],
              related_to: [
                { direction: 'out', target_id: 'module.C', target_title: 'C', target_type: 'module', target_status: 'active', source: 'inferred', confidence: 0.8 },
              ],
            },
          };
        },
        close: async () => { calls.push('close'); },
      };
    };

    const result = await relationsQuery(path.join(root, '.pmem'), 'module.Hub', { source: 'all' });

    assert.deepStrictEqual(calls, [`open:${path.dirname(path.join(root, '.pmem'))}`, 'related:module.Hub:undefined:all', 'close']);
    assert.strictEqual(result.card_id, 'module.Hub');
    assert.strictEqual(result.total, 3);
    assert.deepStrictEqual(result.summary_by_type, { related_to: 1, depends_on: 2 });
    assert.deepStrictEqual(result.summary_by_source, { inferred: 1, mention: 1, explicit: 1 });
    assert.deepStrictEqual(result.pruning_candidates.map(p => `${p.direction}:${p.other_id}:${p.reason}`).sort(), [
      'in:module.B:low_confidence',
      'out:module.C:inferred',
    ]);
  });
});
