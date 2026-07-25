import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { execSync } from 'child_process';
import { atomicWrite, fileExists, getFileMtime, isPathMatch, readFile } from '../fs';
import { openDatabase, createSchema, closeDatabase } from '../db';
import { parseGitStatusPorcelain } from '../git';
import { loadManifest, resolveConfig } from '../manifest';
import { parseFrontmatter } from '../yaml';
import type { Manifest } from '../../types';

interface FileChange {
  path: string;
  status: string;
  related_cards: Array<{ card_id: string; match_type: string }>;
  observed?: ObservedFile;
}

interface ObservedFile {
  mtime_ms: number;
  size: number;
  sha256: string;
}

interface PersistedFileChange extends ObservedFile {
  path: string;
  status: string;
}

interface PersistedMtimeSnapshot {
  version: 1;
  /** Scan-start watermark. Files created during a scan remain eligible next time. */
  watermark_ms: number;
  /** Changes remain pending until a mutating workflow explicitly acknowledges them. */
  pending: Array<Partial<ObservedFile> & { path: string; status: string }>;
  /** Acknowledged file versions suppress only the exact content already handled. */
  acknowledged: Array<Partial<ObservedFile> & { path: string }>;
}

interface AffectedCard {
  card_id: string;
  match_type: 'exact' | 'directory' | 'graph_neighbor' | 'new_card' | 'modified_card';
  matched_file?: string;
  matched_dir?: string;
  via_card?: string;
}

const MATCH_PRIORITY: Record<string, number> = {
  exact: 3,
  directory: 2,
  graph_neighbor: 1,
  new_card: 3,
  modified_card: 3,
};

export interface StatusResult {
  checked_at: string;
  source: 'git' | 'mtime';
  changes: Array<{
    path: string;
    status: string;
    related_cards: Array<{ card_id: string; match_type: string }>;
  }>;
  affected_cards: Array<{
    id: string;
    card_id: string;
    reason: 'source_file_changed' | 'new_card' | 'modified_card';
    match_type?: string;
    matched_file?: string;
    matched_dir?: string;
    via_card?: string;
  }>;
  needs_rebuild: boolean;
  state: 'no_changes' | 'source_changes_only' | 'memory_changes_detected' | 'mixed';
  suggested_action: string | null;
}

export function statusQuery(pmemPath: string, options?: {
  since?: string;
  db?: Database.Database;
  cwd?: string;
}): StatusResult {
  const cwd = options?.cwd ?? process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(pmemPath)) {
    throw new Error('No .pmem directory found. Run `pmem init` first.');
  }

  const source = detectChangesFrom(cwd);
  const changes = getChangedFiles(pmemPath, cwd, options?.since, source);

  const affectedCards = new Map<string, AffectedCard>();

  if (fileExists(dbPath)) {
    const db = options?.db ?? openDatabase(pmemPath);
    if (!options?.db) createSchema(db);

    // Pass 1: Exact path matching
    try {
      const allPaths = db.prepare(
        "SELECT card_id, path FROM paths"
      ).all() as Array<{ card_id: string; path: string }>;

      for (const change of changes) {
        for (const p of allPaths) {
          if (isPathMatch(change.path, p.path)) {
            change.related_cards.push({ card_id: p.card_id, match_type: 'exact' });
            upsertAffectedCard(affectedCards, {
              card_id: p.card_id,
              match_type: 'exact',
              matched_file: change.path,
            });
          }
        }
      }
    } catch { /* ignore query errors */ }

    // Pass 2: Directory-level fuzzy matching
    try {
      const dirSet = new Set<string>();
      for (const change of changes) {
        const dir = path.dirname(change.path);
        if (dir && dir !== '.') {
          dirSet.add(dir);
        }
      }
      for (const dir of dirSet) {
        const dirPattern = dir + '/%';
        const dirRows = db.prepare(
          "SELECT card_id, path FROM paths WHERE path LIKE ?"
        ).all(dirPattern) as Array<{ card_id: string; path: string }>;
        for (const row of dirRows) {
          upsertAffectedCard(affectedCards, {
            card_id: row.card_id,
            match_type: 'directory',
            matched_dir: dir + '/',
          });
        }
      }
    } catch { /* ignore query errors */ }

    // Pass 3: Graph neighbor expansion (one-hop)
    if (affectedCards.size > 0) {
      const affectedCardIds = [...affectedCards.keys()];
      const placeholders = affectedCardIds.map(() => '?').join(',');
      try {
        const edgeRows = db.prepare(
          `SELECT from_id, to_id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`
        ).all(...affectedCardIds, ...affectedCardIds) as Array<{ from_id: string; to_id: string }>;

        for (const edge of edgeRows) {
          if (affectedCards.has(edge.from_id) && !affectedCards.has(edge.to_id)) {
            upsertAffectedCard(affectedCards, {
              card_id: edge.to_id,
              match_type: 'graph_neighbor',
              via_card: edge.from_id,
            });
          }
          if (affectedCards.has(edge.to_id) && !affectedCards.has(edge.from_id)) {
            upsertAffectedCard(affectedCards, {
              card_id: edge.from_id,
              match_type: 'graph_neighbor',
              via_card: edge.to_id,
            });
          }
        }
      } catch { /* ignore query errors */ }
    }
  }

  // === Pass 4: Detect new/modified markdown files under .pmem directly ===
  // This catches cards whose frontmatter id is not yet in the SQLite paths table
  // (i.e., before a pmem rebuild).
  const existingCardIds = collectExistingCardIds(dbPath, options?.db);
  const needsRebuild = detectMemoryCardChanges(cwd, changes, affectedCards, existingCardIds, source);

  const affectedCardsList = [...affectedCards.values()];
  const state = deriveState(changes.length, affectedCardsList, needsRebuild);

  return {
    checked_at: new Date().toISOString(),
    source,
    changes: changes.map(c => ({
      path: c.path,
      status: c.status,
      related_cards: c.related_cards,
    })),
    affected_cards: affectedCardsList.map(ac => {
      const obj: Record<string, unknown> = {
        id: ac.card_id,
        card_id: ac.card_id,
        reason: deriveReason(ac.match_type),
        match_type: ac.match_type,
      };
      if (ac.matched_file) obj.matched_file = ac.matched_file;
      if (ac.matched_dir) obj.matched_dir = ac.matched_dir;
      if (ac.via_card) obj.via_card = ac.via_card;
      return obj as any;
    }),
    needs_rebuild: needsRebuild,
    state,
    suggested_action: buildSuggestedAction(affectedCards.size, needsRebuild, changes.length),
  };
}

function deriveReason(matchType: AffectedCard['match_type']): 'source_file_changed' | 'new_card' | 'modified_card' {
  if (matchType === 'new_card') return 'new_card';
  if (matchType === 'modified_card') return 'modified_card';
  return 'source_file_changed';
}

function deriveState(
  changeCount: number,
  affectedCards: AffectedCard[],
  needsRebuild: boolean,
): StatusResult['state'] {
  if (changeCount === 0) return 'no_changes';
  const hasMemoryChange = affectedCards.some(
    (ac) => ac.match_type === 'new_card' || ac.match_type === 'modified_card'
  );
  const hasSourceChange = affectedCards.some(
    (ac) => ac.match_type === 'exact' || ac.match_type === 'directory' || ac.match_type === 'graph_neighbor'
  );
  if (needsRebuild || hasMemoryChange) {
    return hasSourceChange ? 'mixed' : 'memory_changes_detected';
  }
  if (hasSourceChange || changeCount > 0) return 'source_changes_only';
  return 'no_changes';
}

function buildSuggestedAction(affectedCount: number, needsRebuild: boolean, changeCount = 0): string | null {
  if (needsRebuild) return 'pmem rebuild';
  if (affectedCount > 0) return 'pmem mark-dirty --auto';
  if (changeCount > 0) return 'review source changes; no related memory cards found';
  return null;
}

/**
 * Collect the set of card IDs already present in the SQLite `paths` table.
 * Used to distinguish "new_card" (frontmatter id not in DB) from
 * "modified_card" (frontmatter id already in DB but content changed).
 * Returns an empty set if the DB is missing or unreadable.
 */
function collectExistingCardIds(dbPath: string, existingDb?: Database.Database): Set<string> {
  const ids = new Set<string>();
  if (!fileExists(dbPath)) return ids;
  try {
    const db = existingDb ?? openDatabase(path.dirname(dbPath));
    try {
      const rows = db.prepare('SELECT DISTINCT card_id FROM paths').all() as Array<{ card_id: string }>;
      for (const row of rows) {
        if (row.card_id) ids.add(row.card_id);
      }
    } finally {
      if (!existingDb) closeDatabase();
    }
  } catch { /* ignore — fall back to empty set */ }
  return ids;
}

/**
 * Inspect markdown files under .pmem inside the change list and surface their
 * frontmatter id directly, so callers (CLI / MCP / agents) don't have to wait
 * for a pmem rebuild to see new cards in affected_cards.
 *
 * Returns true if at least one .pmem markdown file was added or modified —
 * caller should set needs_rebuild = true in that case.
 */
function detectMemoryCardChanges(
  cwd: string,
  changes: FileChange[],
  affectedCards: Map<string, AffectedCard>,
  existingCardIds: Set<string>,
  source: StatusResult['source'],
): boolean {
  let needsRebuild = false;

  for (const change of changes) {
    // Only inspect markdown files under .pmem/
    if (!change.path.startsWith('.pmem/')) continue;
    if (!change.path.endsWith('.md')) continue;
    // Skip non-card artifacts (skills / candidates / summaries / indexes / db).
    if (change.path.startsWith('.pmem/skills/')) continue;
    if (change.path.startsWith('.pmem/candidates/')) continue;
    if (change.path.startsWith('.pmem/summaries/')) continue;
    if (change.path.startsWith('.pmem/indexes/')) continue;

    const status = (change.status || '').toUpperCase();
    // Treat anything that is not deletion as relevant for rebuild:
    //   'A' / '??' (added), 'M' (modified), 'R' (renamed), 'C' (copied), etc.
    const isAddedOrModified =
      status === 'A' || status === '??' || status === 'M' ||
      status === 'R' || status === 'C' || status === 'AM';
    if (!isAddedOrModified) continue;
    // The source-of-truth file changed even if its frontmatter is invalid.
    // Rebuild is responsible for reporting the specific parse diagnostic.
    needsRebuild = true;

    const absPath = path.join(cwd, change.path);
    const content = readFile(absPath);
    if (content === null) continue;

    const fm = parseFrontmatter(content);
    if (!fm) continue;
    const rawId = fm.data.id;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) continue;

    // Determine new vs modified:
    //   - Git explicit 'A' / '??' (untracked) => new_card.
    //   - Git explicit 'M' (modified tracked file) => modified_card,
    //     because the file WAS tracked before this change.
    //   - For mtime-mode (no git signal) or other ambiguous statuses,
    //     consult the SQLite paths table:
    //       - id present in DB => modified_card
    //       - id absent          => new_card
    let matchType: AffectedCard['match_type'];
    if (source === 'mtime') {
      matchType = existingCardIds.has(id) ? 'modified_card' : 'new_card';
    } else if (status === 'A' || status === '??') {
      matchType = 'new_card';
    } else if (status === 'M' || status === 'AM') {
      matchType = 'modified_card';
    } else {
      // R / C / mtime-mode / unknown — fall back to DB lookup.
      matchType = existingCardIds.has(id) ? 'modified_card' : 'new_card';
    }
    change.related_cards.push({ card_id: id, match_type: matchType });
    upsertAffectedCard(affectedCards, {
      card_id: id,
      match_type: matchType,
      matched_file: change.path,
    });
  }

  return needsRebuild;
}

function upsertAffectedCard(map: Map<string, AffectedCard>, card: AffectedCard): void {
  const existing = map.get(card.card_id);
  if (!existing || MATCH_PRIORITY[card.match_type] > MATCH_PRIORITY[existing.match_type]) {
    map.set(card.card_id, card);
  }
}

function detectChangesFrom(cwd: string = process.cwd()): 'git' | 'mtime' {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
    return 'git';
  } catch {
    return 'mtime';
  }
}

function getChangedFiles(
  pmemPath: string,
  cwd: string,
  since?: string,
  detectedSource: StatusResult['source'] = detectChangesFrom(cwd),
): FileChange[] {
  const changes = new Map<string, FileChange>();
  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest as Manifest) : null;

  const userSkipDirs = (manifest as any)?.change_detection?.skip_dirs || [];
  const systemSkips = [
    'node_modules', '.git', 'dist', 'build', '.claude',
    '.pmem/pmem.db', '.pmem/indexes', '.pmem/.lock',
    '.pmem/skills', '.pmem/candidates', '.pmem/summaries',
    '.pmem/integrations', '.pmem/backups',
    '.pmem/index.md', '.pmem/state.md', '.pmem/next.md',
    '.pmem/.last-status', '.pmem/.last-status.tmp'
  ];
  // Legacy manifests still resolve the v0.6.x card directories through
  // resolveConfig(). Excluding the whole .pmem tree here would make those
  // scan roots unreachable in non-Git projects, so both legacy and schema
  // manifests use the same derived-file exclusions.
  const skipDirs = Array.from(new Set([...userSkipDirs, ...systemSkips]));

  try {
    if (detectedSource === 'git') {
      const output = execSync('git status --porcelain -u', { cwd, encoding: 'utf-8', timeout: 5000 });
      for (const change of parseGitStatusPorcelain(output)) {
        if (skipDirs.some(d => change.path.startsWith(d + '/') || change.path === d)) continue;
        upsertFileChange(changes, change.path, change.status || 'M');
      }
      return sortedFileChanges(changes);
    }
  } catch { /* fall through to mtime */ }

  // Mtime-based fallback
  const lastStatusFile = path.join(cwd, '.pmem', '.last-status');
  const scanStartedAt = Date.now();
  const snapshot = readMtimeSnapshot(lastStatusFile);
  const lastCheck = since ? new Date(since).getTime() : snapshot.watermark_ms;

  // Status/context are read operations: previously observed changes stay pending
  // until mark-dirty/sync/capture/rebuild acknowledges a successful mutation.
  if (!since) {
    for (const pending of snapshot.pending) {
      upsertFileChange(changes, pending.path, pending.status, observedFromPersisted(pending));
    }
  }

  const defaultScanDirs = ['src', 'lib', 'app', 'tests'];
  const mtimeScanDirs = (manifest as any)?.change_detection?.mtime_scan_dirs || defaultScanDirs;

  const scanRoots = new Set<string>();
  for (const dir of mtimeScanDirs) {
    scanRoots.add(path.resolve(cwd, dir));
  }
  if (config) {
    for (const dir of Object.values(config.type_dirs)) {
      scanRoots.add(path.resolve(cwd, '.pmem', dir));
    }
  }

  // An explicit --since query is an independent historical view and must not
  // inherit acknowledgements from the rolling operational snapshot.
  const acknowledged = new Map(
    since ? [] : snapshot.acknowledged.map(entry => [entry.path, entry]),
  );
  for (const dirPath of [...scanRoots].sort()) {
    if (!fileExists(dirPath)) continue;
    scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes, acknowledged);
  }

  const result = sortedFileChanges(changes);
  if (!since) {
    writeMtimeSnapshot(lastStatusFile, {
      version: 1,
      watermark_ms: scanStartedAt,
      pending: result.map(change => persistedChange(change)),
      // Once an acknowledged version falls behind the new scan-start
      // watermark it has been safely traversed and no longer needs a tombstone.
      // Versions at/after the boundary remain to suppress only that exact
      // content while preserving later edits through fingerprint mismatch.
      acknowledged: snapshot.acknowledged.filter(entry =>
        !Number.isFinite(entry.mtime_ms) || entry.mtime_ms! >= scanStartedAt),
    });
  }

  return result;
}

function scanDirMtime(
  dirPath: string,
  cwd: string,
  since: number,
  skipDirs: string[],
  changes: Map<string, FileChange>,
  acknowledged: Map<string, Partial<ObservedFile> & { path: string }>,
): void {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(cwd, fullPath);
      if (skipDirs.some(d => relPath.startsWith(d + '/') || relPath === d)) continue;

      if (entry.isDirectory()) {
        scanDirMtime(fullPath, cwd, since, skipDirs, changes, acknowledged);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= since) {
            let observed: ObservedFile | undefined;
            try { observed = observeFile(fullPath, stat); } catch { /* still report unreadable files */ }
            const normalizedPath = relPath.split(path.sep).join('/');
            if (observed && sameObservedFile(observed, acknowledged.get(normalizedPath))) continue;
            upsertFileChange(changes, relPath, 'M', observed);
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
}

function upsertFileChange(
  changes: Map<string, FileChange>,
  filePath: string,
  status: string,
  observed?: ObservedFile,
): void {
  const normalizedPath = filePath.split(path.sep).join('/');
  const existing = changes.get(normalizedPath);
  if (existing) {
    if (!existing.status && status) existing.status = status;
    if (observed) existing.observed = observed;
    return;
  }
  changes.set(normalizedPath, { path: normalizedPath, status, related_cards: [], observed });
}

function sortedFileChanges(changes: Map<string, FileChange>): FileChange[] {
  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function readMtimeSnapshot(snapshotPath: string): PersistedMtimeSnapshot {
  const content = readFile(snapshotPath);
  if (content) {
    try {
      const parsed = JSON.parse(content) as Partial<PersistedMtimeSnapshot>;
      if (parsed.version === 1 && Number.isFinite(parsed.watermark_ms) && Array.isArray(parsed.pending)) {
        return {
          version: 1,
          watermark_ms: parsed.watermark_ms!,
          pending: parsed.pending.filter((item): item is PersistedFileChange =>
            Boolean(item) && typeof item.path === 'string' && typeof item.status === 'string'),
          acknowledged: Array.isArray(parsed.acknowledged)
            ? parsed.acknowledged.filter((item): item is PersistedFileChange =>
              Boolean(item) && typeof item.path === 'string')
            : [],
        };
      }
    } catch {
      // Legacy v1.2.0 files stored a plain ISO timestamp; migrate on next write.
      const legacyTimestamp = new Date(content.trim()).getTime();
      if (Number.isFinite(legacyTimestamp)) {
        return { version: 1, watermark_ms: legacyTimestamp, pending: [], acknowledged: [] };
      }
    }
  }
  return { version: 1, watermark_ms: getFileMtime(snapshotPath) || 0, pending: [], acknowledged: [] };
}

function observeFile(filePath: string, stat = fs.statSync(filePath)): ObservedFile {
  return {
    mtime_ms: stat.mtimeMs,
    size: stat.size,
    sha256: createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function observedFromPersisted(value: Partial<ObservedFile>): ObservedFile | undefined {
  return Number.isFinite(value.mtime_ms) && Number.isFinite(value.size) && typeof value.sha256 === 'string'
    ? { mtime_ms: value.mtime_ms!, size: value.size!, sha256: value.sha256 }
    : undefined;
}

function sameObservedFile(observed: ObservedFile, persisted?: Partial<ObservedFile>): boolean {
  return Boolean(
    persisted &&
    persisted.mtime_ms === observed.mtime_ms &&
    persisted.size === observed.size &&
    persisted.sha256 === observed.sha256,
  );
}

function persistedChange(change: FileChange): PersistedMtimeSnapshot['pending'][number] {
  return change.observed
    ? { path: change.path, status: change.status, ...change.observed }
    : { path: change.path, status: change.status };
}

function writeMtimeSnapshot(snapshotPath: string, snapshot: PersistedMtimeSnapshot): void {
  atomicWrite(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
}

/**
 * Remove successfully handled paths from the non-git pending snapshot.
 * Git projects have no persisted mtime snapshot, so this is a safe no-op there.
 */
export function acknowledgeStatusChanges(pmemPath: string, paths: string[]): void {
  if (paths.length === 0) return;
  const snapshotPath = path.join(pmemPath, '.last-status');
  const content = readFile(snapshotPath);
  if (!content) return;

  let parsed: PersistedMtimeSnapshot;
  try {
    const value = JSON.parse(content) as PersistedMtimeSnapshot;
    if (value.version !== 1 || !Array.isArray(value.pending) || !Number.isFinite(value.watermark_ms)) return;
    parsed = { ...value, acknowledged: Array.isArray(value.acknowledged) ? value.acknowledged : [] };
  } catch {
    return;
  }

  const acknowledged = new Set(paths.map(filePath => filePath.split(path.sep).join('/')));
  const handledVersions: Array<ObservedFile & { path: string }> = [];
  for (const change of parsed.pending) {
    if (!acknowledged.has(change.path)) continue;
    const observed = observedFromPersisted(change);
    if (observed) {
      handledVersions.push({ path: change.path, ...observed });
      continue;
    }
    try {
      handledVersions.push({
        path: change.path,
        ...observeFile(path.join(path.dirname(pmemPath), change.path)),
      });
    } catch { /* deleted paths need no fingerprint tombstone */ }
  }
  const pending = parsed.pending.filter(change => !acknowledged.has(change.path));
  if (pending.length === parsed.pending.length) return;
  const acknowledgedByPath = new Map(parsed.acknowledged.map(entry => [entry.path, entry]));
  for (const entry of handledVersions) acknowledgedByPath.set(entry.path, entry);
  writeMtimeSnapshot(snapshotPath, {
    ...parsed,
    pending,
    acknowledged: [...acknowledgedByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  });
}
