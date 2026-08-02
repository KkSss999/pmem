import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  CROSS_STORE_ATOMICITY,
  MarkdownProjectionError,
  exportMarkdownRecord,
  importMarkdownRecord,
  inspectMarkdownProjectionJournal,
  rebuildMarkdownProjection,
  recoverMarkdownProjection,
  serializeMarkdownRecord,
} from './markdown';
import { importLegacyCardMarkdown } from '../compatibility/v1_2_markdown';

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-markdown-projection-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function record(filePath: string, body = '# Decision\n\nCanonical body.'): any {
  return {
    id: 'decision.projection',
    schema: { id: 'decision', version: '1' },
    data: { id: 'decision.projection', type: 'decision', status: 'completed', custom: 'kept', body },
    scope: 'workspace',
    provenance: { source: 'markdown', source_id: filePath },
    created_at: '1970-01-01T00:00:00.000Z',
    updated_at: '1970-01-01T00:00:00.000Z',
  };
}

describe('Markdown Projection', () => {
  it('serializes and imports schema-driven canonical Markdown without Card fields', () => {
    const root = tempRoot();
    const file = path.join(root, 'decisions', 'decision.projection.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeMarkdownRecord({
      id: 'character.alice',
      schema: { id: 'character', version: '1' },
      data: { name: 'Alice', age: 20, body: '# Alice' },
      scope: { id: 'world-1', kind: 'world' },
      provenance: { source: 'test' },
      created_at: '1970-01-01T00:00:00.000Z',
      updated_at: '1970-01-01T00:00:00.000Z',
    }));
    const imported = importMarkdownRecord(file);
    assert.equal(imported.id, 'character.alice');
    assert.equal(imported.data.name, 'Alice');
    const rendered = serializeMarkdownRecord(imported, file);
    assert.match(rendered, /schema:/);
    assert.match(rendered, /Alice/);
  });

  it('keeps v1.2 Card parsing in the explicit LegacyCardImporter', () => {
    const root = tempRoot();
    const file = path.join(root, 'legacy.md');
    fs.writeFileSync(file, '---\nid: decision.projection\ntype: decision\ncustom: kept\n---\n# Decision\n');
    const imported = importLegacyCardMarkdown(file);
    assert.equal(imported.id, 'decision.projection');
    assert.equal(imported.data.custom, 'kept');
  });

  it('publishes by temp-file + rename and removes journal/temporary artifacts', () => {
    const root = tempRoot();
    const file = path.join(root, 'decisions', 'decision.projection.md');
    const result = exportMarkdownRecord(record(file), file);
    assert.equal(result.state, 'published');
    assert.equal(result.recovered, false);
    assert.equal(importMarkdownRecord(file).data.body, '# Decision\n\nCanonical body.');
    assert.equal(fs.existsSync(result.journalPath), false);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['decision.projection.md']);
  });

  it('recovers the previous projection when publication fails after backup', () => {
    const root = tempRoot();
    const file = path.join(root, 'decision.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serializeMarkdownRecord(record(file, 'old')));
    assert.throws(
      () => exportMarkdownRecord(record(file, 'new'), file, { hooks: { beforePublish: () => { throw new Error('injected publish failure'); } } }),
      (error: unknown) => error instanceof MarkdownProjectionError && error.code === 'IO_ERROR' && /recovered/.test(error.message),
    );
    assert.match(fs.readFileSync(file, 'utf8'), /old/);
    assert.deepEqual(fs.readdirSync(root), ['decision.md']);
  });

  it('replays an interrupted temp_written journal and restores backup', () => {
    const root = tempRoot();
    const file = path.join(root, 'decision.md');
    const journal = `${file}.journal.json`;
    const temp = `${file}.tmp.interrupted`;
    const backup = `${file}.bak.interrupted`;
    fs.writeFileSync(file, 'new content');
    fs.writeFileSync(backup, 'old content');
    fs.writeFileSync(temp, 'partial content');
    fs.writeFileSync(journal, JSON.stringify({
      protocol: 'v1', operationId: 'interrupted', targetPath: file, tempPath: temp, backupPath: backup,
      state: 'temp_written', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));
    const result = recoverMarkdownProjection(journal);
    assert.equal(result.state, 'recovered');
    assert.equal(fs.readFileSync(file, 'utf8'), 'old content');
    assert.equal(fs.existsSync(journal), false);
    assert.equal(fs.existsSync(temp), false);
  });

  it('keeps malformed Markdown and malformed journals on explicit error paths', () => {
    const root = tempRoot();
    const file = path.join(root, 'broken.md');
    fs.writeFileSync(file, '# no frontmatter\n');
    assert.throws(() => importMarkdownRecord(file), (error: unknown) => error instanceof MarkdownProjectionError && error.code === 'INVALID_MARKDOWN');
    const journal = `${file}.journal.json`;
    fs.writeFileSync(journal, '{"protocol":"future"}');
    assert.throws(() => inspectMarkdownProjectionJournal(journal), (error: unknown) => error instanceof MarkdownProjectionError && error.code === 'INVALID_JOURNAL');
  });

  it('documents that projection durability is not cross-store ACID', () => {
    assert.equal(CROSS_STORE_ATOMICITY, 'journaled-filesystem-only');
  });

  it('rebuilds a projection tree and rolls back an injected backend transaction on malformed cards', async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'decisions', 'valid.md'), serializeMarkdownRecord({ ...record(path.join(root, 'decisions', 'valid.md'), 'valid'), id: 'decision.valid' }));
    fs.writeFileSync(path.join(root, 'decisions', 'broken.md'), '# missing frontmatter\n');
    let rollbackCalled = false;
    let commitCalled = false;
    const transaction = {
      id: 'rebuild-test', atomic: true,
      putRecord: () => undefined,
      rollback: () => { rollbackCalled = true; },
      commit: () => { commitCalled = true; },
    } as any;
    const result = await rebuildMarkdownProjection(root, { transaction });
    assert.equal(result.scanned, 2);
    assert.equal(result.imported, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.committed, false);
    assert.equal(result.rolledBack, true);
    assert.equal(rollbackCalled, true);
    assert.equal(commitCalled, false);
  });
});
