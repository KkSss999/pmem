import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyHealthMigration, parseClassificationByType, planHealthMigration } from './migration';
import { getDefaultManifest, saveManifest } from '../manifest';
import { closeDatabase, openOwnedDatabase } from '../db';
import { rebuildCommand } from '../../commands/rebuild';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(type = 'module'): { root: string; pmemPath: string; card: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-health-migrate-'));
  roots.push(root);
  const pmemPath = path.join(root, '.pmem');
  const dir = path.join(pmemPath, `${type}s`);
  fs.mkdirSync(dir, { recursive: true });
  const card = path.join(dir, `${type}.one.md`);
  fs.writeFileSync(card, `---\nid: ${type}.one\ntype: ${type}\nstatus: active\n---\n# One\n`);
  return { root, pmemPath, card };
}

describe('health metadata migration', () => {
  it('defaults to a zero-write dry-run with unresolved trusted metadata', () => {
    const { root, pmemPath, card } = fixture();
    const before = fs.readFileSync(card, 'utf8');
    const result = planHealthMigration(pmemPath, { cwd: root });
    assert.equal(result.mode, 'dry-run');
    assert.deepEqual(result.cards[0].unresolved.sort(), ['classification', 'sensitivity', 'trust_label']);
    assert.equal(fs.readFileSync(card, 'utf8'), before);
  });

  it('requires every ambiguous choice before apply', () => {
    const { root, pmemPath } = fixture();
    assert.throws(() => applyHealthMigration(pmemPath, { apply: true, trustLabel: 'application_trusted', sensitivity: 'internal', cwd: root }), /unresolved metadata/);
  });

  it('applies explicit metadata atomically, creates a backup, and is idempotent', () => {
    const { root, pmemPath, card } = fixture('module');
    const options = {
      apply: true,
      trustLabel: 'application_trusted',
      sensitivity: 'internal',
      classificationByType: { module: 'fact' },
      cwd: root,
    };
    const first = applyHealthMigration(pmemPath, options);
    const content = fs.readFileSync(card, 'utf8');
    assert.match(content, /classification: fact/);
    assert.match(content, /trust_label: application_trusted/);
    assert.match(content, /sensitivity: internal/);
    assert.ok(first.backup_path);
    assert.ok(fs.existsSync(path.join(root, first.backup_path!, 'modules', 'module.one.md')));
    const second = applyHealthMigration(pmemPath, options);
    assert.equal(second.changed, 0);
  });

  it('infers only unambiguous card types and validates mappings', () => {
    const { root, pmemPath } = fixture('decision');
    const plan = planHealthMigration(pmemPath, { cwd: root });
    assert.equal(plan.cards[0].add.classification, 'decision');
    assert.deepEqual(parseClassificationByType('module=fact,resource=question'), { module: 'fact', resource: 'question' });
    assert.throws(() => parseClassificationByType('module=wrong'), /Invalid classification/);
  });

  it('lists every accepted trust label when validation fails without writing files', () => {
    const { root, pmemPath, card } = fixture();
    const before = fs.readFileSync(card, 'utf8');
    assert.throws(
      () => planHealthMigration(pmemPath, { cwd: root, trustLabel: 'trusted' }),
      /Invalid trust label "trusted"\. Valid values: system_trusted, user_confirmed, application_trusted, agent_generated, tool_observed, imported_external, untrusted_content\./,
    );
    assert.equal(fs.readFileSync(card, 'utf8'), before);
  });

  it('rebuilds the restored Markdown snapshot when post-commit index work fails', () => {
    const { root, pmemPath, card } = fixture('module');
    saveManifest(pmemPath, getDefaultManifest('migration-rollback'));
    rebuildCommand({ cwd: root, full: true });
    const original = fs.readFileSync(card, 'utf8');
    let rollbackRebuilds = 0;

    assert.throws(() => applyHealthMigration(pmemPath, {
      apply: true,
      trustLabel: 'application_trusted',
      sensitivity: 'internal',
      classificationByType: { module: 'fact' },
      cwd: root,
      afterApply: () => {
        rebuildCommand({ cwd: root, full: true });
        throw new Error('simulated post-commit graph failure');
      },
      afterRollback: () => {
        rollbackRebuilds++;
        rebuildCommand({ cwd: root, full: true });
      },
    }), /simulated post-commit graph failure/);

    assert.equal(fs.readFileSync(card, 'utf8'), original);
    assert.equal(rollbackRebuilds, 1);
    const db = openOwnedDatabase(pmemPath);
    try {
      const row = db.prepare('SELECT classification, trust_label, sensitivity FROM cards WHERE id = ?').get('module.one') as {
        classification: string | null;
        trust_label: string | null;
        sensitivity: string | null;
      };
      assert.deepEqual(row, { classification: null, trust_label: null, sensitivity: null });
    } finally {
      closeDatabase(db);
    }
  });
});
