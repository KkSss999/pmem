import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, getLockInfo, listFiles } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openMaintenanceDatabase, createSchema, closeDatabase } from '../runtime/maintenance';
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
  const sourceCardCount = fileExists(pmemPath) ? countSourceCardFiles(pmemPath) : 0;

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
  const db = openMaintenanceDatabase(pmemPath);
      createSchema(db);

      // Card count
      const cardRow = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0').get() as { count: number };
      const cardCount = cardRow?.count ?? 0;
      const deletedRow = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 1').get() as { count: number };
      const deletedCardCount = deletedRow?.count ?? 0;
      const isCandidate = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0 AND is_candidate = 1').get() as { count: number };

      checks.push({
        name: 'database',
        status: 'ok',
        message: `pmem.db healthy. ${cardCount} card(s)${isCandidate?.count > 0 ? ` (${isCandidate.count} candidate(s))` : ''}.`,
      });

      // 4. Cards
      if (cardCount === 0 && sourceCardCount > 0) {
        checks.push({
          name: 'card_index',
          status: 'warn',
          message: `${sourceCardCount} source card file(s) exist but 0 active cards are indexed${deletedCardCount > 0 ? ` (${deletedCardCount} tombstone row(s) remain)` : ''}. The SQLite index may be stale or the cards may be invalid.`,
          fix: 'Run: pmem rebuild, then review any skipped-card diagnostics.',
        });
      } else if (sourceCardCount === 0) {
        checks.push({
          name: 'cards',
          status: 'warn',
          message: 'No memory card files found.',
          fix: 'Create one with: pmem new module "Core" --id core',
        });
      } else if (sourceCardCount !== cardCount) {
        checks.push({
          name: 'card_index',
          status: 'warn',
          message: `${sourceCardCount} source card file(s) exist but ${cardCount} active card(s) are indexed${deletedCardCount > 0 ? ` (${deletedCardCount} tombstone row(s) remain)` : ''}.`,
          fix: 'Run: pmem rebuild, then review any skipped-card diagnostics.',
        });
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
      const sessionRow = db.prepare("SELECT id, agent_name FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string; agent_name: string | null } | undefined;
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

  // 7b. Lock status (v0.6.4 polish 6: richer output with age, owner, suggestions)
  const lockPath = path.join(pmemPath, '.lock');
  const lockInfo = getLockInfo(lockPath);
  if (!lockInfo.exists) {
    checks.push({ name: 'lock', status: 'ok', message: 'No lock held.' });
  } else if (lockInfo.is_stale) {
    const ageSec = lockInfo.age_seconds !== null ? lockInfo.age_seconds : '?';
    const ownerLabel = lockInfo.owner_pid !== null ? `pmem (PID: ${lockInfo.owner_pid})` : 'pmem (PID: unknown)';
    checks.push({
      name: 'lock',
      status: 'warn',
      message: `Stale lock held at .pmem/.lock\n        Owner: ${ownerLabel}\n        Age: ${ageSec}s (stale threshold: ${lockInfo.stale_threshold_seconds}s)`,
      fix: 'Run: pmem verify --fix-locks  (to clean stale lock)\n       Or: pmem doctor (to diagnose lock status)',
    });
  } else {
    const ageSec = lockInfo.age_seconds !== null ? lockInfo.age_seconds : '?';
    const ownerLabel = lockInfo.owner_pid !== null ? `pmem (PID: ${lockInfo.owner_pid})` : 'pmem (PID: unknown)';
    const pidHint = lockInfo.owner_pid !== null ? `\n        → Or check process: ps -p ${lockInfo.owner_pid}` : '';
    checks.push({
      name: 'lock',
      status: 'warn',
      message: `Active lock held at .pmem/.lock\n        Owner: ${ownerLabel}\n        Age: ${ageSec}s (stale threshold: ${lockInfo.stale_threshold_seconds}s)`,
      fix: `If another pmem is not actually running, wait ${lockInfo.stale_threshold_seconds}s and run: pmem verify --fix-locks${pidHint}`,
    });
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

function countSourceCardFiles(pmemPath: string): number {
  return listFiles(pmemPath, /\.md$/).filter(filePath => {
    const relative = path.relative(pmemPath, filePath).split(path.sep).join('/');
    if (['index.md', 'state.md', 'next.md'].includes(relative)) return false;
    return ![
      'skills/', 'integrations/', 'summaries/', 'indexes/', 'backups/', 'candidates/',
    ].some(prefix => relative.startsWith(prefix));
  }).length;
}

function outputDoctor(checks: DoctorCheck[], format: CliFormat): void {
  const okCount = checks.filter(c => c.status === 'ok').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const errorCount = checks.filter(c => c.status === 'error').length;
  if (format === 'json') {
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
  }

  // Output format must never change automation semantics. Warnings are a
  // successful diagnostic result (like `pmem verify`); actual errors use the
  // CLI's operational failure code in both compact and JSON modes.
  process.exitCode = errorCount > 0 ? 2 : 0;
}
