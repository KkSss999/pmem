import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openDatabase, createSchema, closeDatabase } from '../core/db';
import type { CliFormat } from '../types';

const PMEM_DIR = '.pmem';

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export function doctorCommand(format: CliFormat = 'compact'): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const checks: DoctorCheck[] = [];

  // 1. .pmem/ exists
  if (!fileExists(pmemPath)) {
    checks.push({ name: 'pmem_dir', status: 'error', message: '.pmem/ directory not found.', fix: 'Run: pmem init <project-name>' });
    outputDoctor(checks, format);
    return;
  }
  checks.push({ name: 'pmem_dir', status: 'ok', message: '.pmem/ directory exists.' });

  // 2. Manifest
  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    checks.push({ name: 'manifest', status: 'error', message: 'manifest.yml not found or invalid.', fix: 'Run: pmem init' });
  } else {
    const schemaVer = manifest.pmem?.schema_version;
    checks.push({
      name: 'manifest',
      status: schemaVer ? 'ok' : 'warn',
      message: schemaVer ? `manifest.yml valid (schema ${schemaVer}).` : 'manifest.yml valid but missing schema_version.',
      fix: schemaVer ? undefined : 'Run: pmem migrate --to 0.3',
    });
  }

  // 3. Database
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    checks.push({ name: 'database', status: 'warn', message: 'pmem.db not found.', fix: 'Run: pmem rebuild' });
  } else {
    try {
      const db = openDatabase(pmemPath);
      createSchema(db);

      // Card count
      const cardRow = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0').get() as { count: number };
      const cardCount = cardRow?.count ?? 0;
      const isCandidate = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0 AND is_candidate = 1').get() as { count: number };

      checks.push({
        name: 'database',
        status: 'ok',
        message: `pmem.db healthy. ${cardCount} card(s)${isCandidate?.count > 0 ? ` (${isCandidate.count} candidate(s))` : ''}.`,
      });

      // 4. Cards
      if (cardCount === 0) {
        checks.push({ name: 'cards', status: 'warn', message: 'No memory cards found.', fix: 'Create a module card with source_files, then run: pmem rebuild' });
      } else {
        checks.push({ name: 'cards', status: 'ok', message: `${cardCount} active card(s).` });
      }

      // 5. Dirty flags
      const dirtyRow = db.prepare('SELECT COUNT(*) as count FROM dirty_flags WHERE resolved_at IS NULL').get() as { count: number };
      const dirtyCount = dirtyRow?.count ?? 0;
      if (dirtyCount > 0) {
        checks.push({ name: 'dirty_flags', status: 'warn', message: `${dirtyCount} unresolved dirty flag(s).`, fix: 'Run: pmem update --suggest' });
      } else {
        checks.push({ name: 'dirty_flags', status: 'ok', message: 'No unresolved dirty flags.' });
      }

      // 6. Active session
      const sessionRow = db.prepare("SELECT id, agent_name FROM sessions WHERE ended_at IS NULL ORDER BY created_at DESC LIMIT 1").get() as { id: string; agent_name: string | null } | undefined;
      if (sessionRow) {
        checks.push({ name: 'session', status: 'ok', message: `Active session: ${sessionRow.id}${sessionRow.agent_name ? ` (${sessionRow.agent_name})` : ''}.` });
      } else {
        checks.push({ name: 'session', status: 'warn', message: 'No active session.', fix: 'Run: pmem session start -a "<agent-name>"' });
      }

      closeDatabase();
    } catch {
      checks.push({ name: 'database', status: 'error', message: 'pmem.db is corrupted or not a valid database.', fix: 'Back up the file, then run: pmem rebuild --full' });
    }
  }

  // 7. Git availability
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
    checks.push({ name: 'git', status: 'ok', message: 'Git repository detected.' });
  } catch {
    checks.push({ name: 'git', status: 'warn', message: 'Not a Git repository.', fix: 'pmem status and mark-dirty --auto will use mtime fallback.' });
  }

  // 8. Integrations
  if (manifest && manifest.integrations?.active?.length > 0) {
    const active = manifest.integrations.active;
    checks.push({ name: 'integrations', status: 'ok', message: `${active.length} active: ${active.join(', ')}.` });
  } else {
    checks.push({ name: 'integrations', status: 'warn', message: 'No integrations installed.', fix: 'Run: pmem integration install <framework>' });
  }

  outputDoctor(checks, format);
}

function outputDoctor(checks: DoctorCheck[], format: CliFormat): void {
  if (format === 'json') {
    const okCount = checks.filter(c => c.status === 'ok').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;
    const errorCount = checks.filter(c => c.status === 'error').length;
    console.log(JSON.stringify({
      overall: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
      summary: `${okCount} ok, ${warnCount} warning(s), ${errorCount} error(s)`,
      checks: checks.map(c => ({
        name: c.name,
        status: c.status,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
    }, null, 2));
  } else {
    const icons: Record<string, string> = { ok: '✓', warn: '⚠', error: '✗' };
    for (const check of checks) {
      console.log(`${icons[check.status]} ${check.message}`);
      if (check.fix) console.log(`  ${check.fix}`);
    }
    const errorCount = checks.filter(c => c.status === 'error').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;
    if (errorCount > 0 || warnCount > 0) {
      process.exit(errorCount > 0 ? 2 : 1);
    }
  }
}
