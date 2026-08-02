import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { closeMaintenanceDatabase, openMaintenanceDatabase } from './maintenance';

const roots: string[] = [];
afterEach(() => { while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('Runtime maintenance boundary', () => {
  it('centralizes legacy SQLite maintenance lifecycle behind one adapter', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-maintenance-'));
    roots.push(root);
    const db = openMaintenanceDatabase(path.join(root, '.pmem'));
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards'").get() as { name?: string } | undefined;
    assert.equal(row?.name, 'cards');
    closeMaintenanceDatabase(db);
    assert.throws(() => db.prepare('SELECT 1').get());
  });

  it('keeps maintenance commands behind the Runtime adapter import boundary', () => {
    const commandFiles = ['rebuild.ts', 'update.ts', 'verify.ts', 'sync.ts', 'doctor.ts', 'session.ts', 'migrate.ts'];
    for (const file of commandFiles) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'commands', file), 'utf8');
      assert.equal(source.includes("from '../core/db'"), false, `${file} must use runtime/maintenance`);
      assert.equal(source.includes('openDatabase('), false, `${file} must not open SQLite directly`);
    }
  });
});
