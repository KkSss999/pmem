import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { fileExists, readFile, writeFile, ensureDir, atomicWrite, getFileMtime } from './fs';
import { loadManifest, saveManifest } from './manifest';
import { rebuildCommand } from '../commands/rebuild';
import { verifyCommand } from '../commands/verify';
import {
  openDatabase,
  createSchema,
  resolveDirtyFlags,
  insertUpdateLog,
  getActiveSession,
  closeDatabase,
  insertDirtyFlag
} from './db';
import { statusQuery } from './query/status';
import type { PmemSessionData } from '../types';

export interface CaptureOptions {
  auto?: boolean;
  summary?: string;
  next?: string;
  full?: boolean;
  force?: boolean;
}

export interface CaptureResult {
  success: boolean;
  message: string;
  tracePath?: string;
  skipped?: boolean;
}

export function captureCore(pmemPath: string, options: CaptureOptions = {}): CaptureResult {
  const cwd = process.cwd();
  
  if (!fileExists(pmemPath)) {
    return {
      success: false,
      message: 'No .pmem directory found. Run pmem init first.'
    };
  }

  // 1. Detect changed files
  let status;
  try {
    status = statusQuery(pmemPath);
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to detect changes: ${err.message}`
    };
  }

  const changedFiles = (status.changes || []).filter(
    f => !f.path.startsWith('.pmem/') && !f.path.startsWith('.pmem\\') && f.path !== '.pmem'
  );
  if (changedFiles.length === 0 && !options.force) {
    return {
      success: true,
      message: 'No changed files detected. Memory is up-to-date.',
      skipped: true
    };
  }

  // 2. Compute git/mtime diff hash for duplicate check
  let diffHash = '';
  try {
    const isGit = (() => {
      try {
        execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    if (isGit) {
      const statusOutput = execSync(
        "git status --porcelain --untracked-files=all -- . ':!.pmem'",
        { cwd, encoding: 'utf8', timeout: 5000 }
      );

      const diffOutput = execSync(
        "git diff HEAD -- . ':!.pmem'",
        { cwd, encoding: 'utf8', timeout: 5000 }
      );

      const untrackedHashes = changedFiles
        .filter(f => f.status.includes('?') || f.status === '??')
        .map(f => {
          const fullPath = path.join(cwd, f.path);
          if (!fileExists(fullPath)) return `${f.path}:missing`;
          try {
            const content = fs.readFileSync(fullPath);
            return `${f.path}:${crypto.createHash('sha256').update(content).digest('hex')}`;
          } catch {
            return `${f.path}:error`;
          }
        })
        .join('\n');

      const combined = [
        statusOutput,
        diffOutput,
        untrackedHashes
      ].join('\n---pmem-diff-boundary---');

      diffHash = crypto.createHash('sha256').update(combined).digest('hex');
    } else {
      // Fallback mtime-based hash of changed files and mtimes
      const mtimeList = changedFiles.map(c => {
        const fullPath = path.join(cwd, c.path);
        const mtime = fileExists(fullPath) ? getFileMtime(fullPath) || 0 : 0;
        return `${c.path}:${mtime}:${c.status}`;
      }).join('\n');
      diffHash = crypto.createHash('sha256').update(mtimeList).digest('hex');
    }
  } catch (err: any) {
    // If diff computation fails, we use a fallback hash based on file names only
    const fallbackList = changedFiles.map(c => `${c.path}:${c.status}`).join('\n');
    diffHash = crypto.createHash('sha256').update(fallbackList).digest('hex');
  }

  // 3. Find the latest trace card and check its diff_hash
  const traceDir = path.resolve(pmemPath, 'traces');
  ensureDir(traceDir);

  if (!options.force && diffHash) {
    try {
      const existingTraceFiles = fs.readdirSync(traceDir)
        .filter((f: string) => f.endsWith('.md'))
        .sort((a, b) => b.localeCompare(a)); // Sort descending to get latest first

      if (existingTraceFiles.length > 0) {
        const latestTracePath = path.join(traceDir, existingTraceFiles[0]);
        const latestTraceContent = readFile(latestTracePath) || '';
        
        // Match diff_hash: "..." or diff_hash: ...
        const diffHashMatch = latestTraceContent.match(/diff_hash:\s*["']?([a-fA-F0-9]+)["']?/);
        if (diffHashMatch && diffHashMatch[1] === diffHash) {
          return {
            success: true,
            message: 'No new capture created. Existing trace already records this diff.',
            skipped: true
          };
        }
      }
    } catch {
      // Ignore directory read/parse errors for safety
    }
  }

  // 4. Resolve summary
  let summary = options.summary;
  if (!summary) {
    // Try to get latest task from session.json
    const sessionPath = path.join(pmemPath, 'session.json');
    if (fileExists(sessionPath)) {
      try {
        const sessionContent = readFile(sessionPath);
        if (sessionContent) {
          const sessionData: PmemSessionData = JSON.parse(sessionContent);
          if (sessionData.latest_task) {
            summary = `Capture: ${sessionData.latest_task}`;
          }
        }
      } catch {
        // Fallback if parsing fails
      }
    }
  }

  if (!summary) {
    // Fallback: list changed files
    const filePaths = changedFiles.map(f => f.path);
    summary = `Automated capture: changed ${filePaths.join(', ')}`;
  }

  // 5. Resolve next
  const next = options.next || 'Continue development.';

  // 6. Create trace card
  const today = new Date().toISOString().split('T')[0];
  let traceFile = '';
  try {
    const existingTraces = fs.readdirSync(traceDir)
      .filter((f: string) => f.startsWith(today) && f.endsWith('.md'))
      .length;

    const traceNum = String(existingTraces + 1).padStart(3, '0');
    traceFile = path.resolve(traceDir, `${today}-${traceNum}.md`);

    // Strict path traversal validation
    if (!traceFile.startsWith(traceDir)) {
      throw new Error('Security: trace path traversal detected');
    }

    const cardId = `trace.${today}-${traceNum}`;
    const traceContent = `---
id: ${cardId}
type: trace
created: ${new Date().toISOString()}
diff_hash: ${diffHash}
---

# Capture: ${summary}

## What changed

${summary}

## Changed files

${changedFiles.map(f => `- ${f.path}`).join('\n')}

## Next

- ${next}
`;

    atomicWrite(traceFile, traceContent);
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to write trace card: ${err.message}`
    };
  }

  // 7. Update .pmem/next.md in managed block
  const nextPath = path.join(pmemPath, 'next.md');
  const managedStart = '<!-- pmem:next:start -->';
  const managedEnd = '<!-- pmem:next:end -->';
  const managedContent = `${managedStart}\n- Recommended next step: ${next}\n${managedEnd}`;

  try {
    if (fileExists(nextPath)) {
      const currentNext = readFile(nextPath) || '';
      const startIndex = currentNext.indexOf(managedStart);
      const endIndex = currentNext.indexOf(managedEnd);

      if (startIndex >= 0 && endIndex >= 0 && endIndex > startIndex) {
        const updatedNext = currentNext.substring(0, startIndex) +
          managedContent +
          currentNext.substring(endIndex + managedEnd.length);
        writeFile(nextPath, updatedNext);
      } else {
        // Managed block not found, append it
        const spacer = currentNext.endsWith('\n') ? '' : '\n';
        writeFile(nextPath, `${currentNext}${spacer}\n${managedContent}\n`);
      }
    } else {
      // Create new file
      writeFile(nextPath, `# Next Steps\n\n${managedContent}\n`);
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to update next.md: ${err.message}`
    };
  }

  // 8. DB transaction to resolve dirty flags
  const dbPath = path.join(pmemPath, 'pmem.db');
  let db: any = null;
  let transactionActive = false;
  let backupManifest = null;
  const manifestPath = path.join(pmemPath, 'manifest.yml');
  const dirtyPath = path.join(pmemPath, '.dirty');

  try {
    const manifest = loadManifest(pmemPath);
    if (manifest) {
      backupManifest = JSON.stringify(manifest);
    }

    if (fileExists(dbPath)) {
      db = openDatabase(pmemPath);
      createSchema(db);

      // Start transaction
      db.prepare('BEGIN TRANSACTION').run();
      transactionActive = true;

      const activeSession = getActiveSession(db);
      
      // Auto mark changed files dirty first to make sure they are tracked before resolving
      const allPaths = db.prepare(
        "SELECT card_id, path FROM paths"
      ).all() as Array<{ card_id: string; path: string }>;

      const dirtyCards: string[] = [];
      for (const change of changedFiles) {
        for (const p of allPaths) {
          if (p.card_id && p.path && change.path) {
            // Check if matches
            const isMatch = (() => {
              const p1 = change.path.replace(/\\/g, '/');
              const p2 = p.path.replace(/\\/g, '/');
              return p1 === p2 || p1.endsWith('/' + p2) || p2.endsWith('/' + p1);
            })();

            if (isMatch) {
              if (!dirtyCards.includes(p.card_id)) {
                insertDirtyFlag(db, 'card', p.card_id, 'file_changed: ' + change.path, activeSession?.id);
                dirtyCards.push(p.card_id);
              }
            }
          }
        }
      }

      // Resolve affected cards dirty flags
      const affectedCards = status.affected_cards || [];
      const cardsToResolve = Array.from(new Set([
        ...dirtyCards,
        ...affectedCards.map((ac: any) => ac.card_id)
      ]));

      for (const cardId of cardsToResolve) {
        resolveDirtyFlags(db, 'card', cardId);
      }

      // Resolve project level dirty flag
      resolveDirtyFlags(db, 'project', '.pmem');

      // Log update to SQLite
      const todayNum = path.basename(traceFile, '.md').split('-').pop() || '001';
      const traceCardId = `trace.${today}-${todayNum}`;
      insertUpdateLog(db, 'confirm_update', summary, activeSession?.id, [traceCardId], true);

      // Commit transaction
      db.prepare('COMMIT').run();
      transactionActive = false;
      closeDatabase();
    }

    // Clean up dirty state in files
    if (fileExists(dirtyPath)) {
      fs.unlinkSync(dirtyPath);
    }
    if (manifest) {
      manifest.memory_status.dirty = false;
      manifest.memory_status.dirty_reason = null;
      manifest.memory_status.dirty_since = null;
      saveManifest(pmemPath, manifest);
    }
  } catch (err: any) {
    if (db && transactionActive) {
      try {
        db.prepare('ROLLBACK').run();
      } catch {}
    }
    try {
      closeDatabase();
    } catch {}

    // Rollback manifest
    if (backupManifest && fileExists(manifestPath)) {
      try {
        saveManifest(pmemPath, JSON.parse(backupManifest));
      } catch {}
    }

    // Rollback trace file
    if (fileExists(traceFile)) {
      try {
        fs.unlinkSync(traceFile);
      } catch {}
    }

    return {
      success: false,
      message: `Failed SQLite transaction: ${err.message}`
    };
  }

  // 9. Run rebuild (incremental or full)
  try {
    rebuildCommand({ full: options.full === true });
  } catch (err: any) {
    return {
      success: false,
      message: `Failed rebuild: ${err.message}`,
      tracePath: traceFile
    };
  }

  // 10. Run lightweight verify
  try {
    verifyCommand({ fix: false, fixLocks: false, fixStale: false, relaxed: true, noExit: true });
  } catch (err: any) {
    // Verification warning only, do not fail capture
  }

  return {
    success: true,
    message: 'Memory sync and update completed successfully.',
    tracePath: traceFile
  };
}
