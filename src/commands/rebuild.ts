import * as path from 'path';
import * as fs from 'fs';
import { readFile, writeJson, listFiles, ensureDir, fileExists, getFileMtime } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openDatabase, createSchema, upsertCard, deleteExplicitCardEdges, insertEdge, deleteCardAliases, insertAlias, deleteCardTags, insertTag, deleteCardPaths, insertPath, clearAllTables, getCardHash, setSchemaVersion, closeDatabase, createFTS5 } from '../core/db';
import { computeCardHashes, tokenCount, sectionCount, computeHash } from '../core/hash';
import { parseFrontmatter } from '../core/yaml';
import type { CardFrontmatter, GraphNode, GraphEdge, GraphIndex, CardRow, EdgeRow } from '../types';

const PMEM_DIR = '.pmem';

interface RebuildOptions {
  changed?: boolean;
  full?: boolean;
  card?: string;
}

interface ParsedCard {
  fullContent: string;
  frontmatterText: string;
  bodyText: string;
  frontmatter: CardFrontmatter;
}

export function rebuildCommand(options: RebuildOptions = {}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    if (fileExists(pmemPath)) {
      console.log('.pmem/manifest.yml not found. Run `pmem init` to regenerate the manifest, or restore it from backup.');
    } else {
      console.log('No .pmem directory found. Run `pmem init` first.');
    }
    return;
  }

  const db = openDatabase(pmemPath);
  createSchema(db);
  setSchemaVersion(db, manifest.pmem.schema_version);

  const isFull = options.full === true;
  const isSingleCard = typeof options.card === 'string';

  // Number of active sessions preserved by the --full snapshot+restore
  // (set inside doRebuild transaction, read after).
  let preservedSessions = 0;

  if (isFull) {
    // v0.6.4 polish 5: preserve active sessions across `rebuild --full`.
    // `clearAllTables` wipes the sessions table, but sessions are runtime
    // state (not derived from markdown cards), so an in-progress session
    // would be lost — causing `pmem session end` to report "No active
    // pmem session found" after a recovery-time `rebuild --full`.
    //
    // v0.6.4 CTO rework (返工 3): snapshot+clear+restore must run inside
    // the same SQLite transaction as the card rebuild. Otherwise a crash
    // between clearAllTables and doRebuild() would leave sessions table
    // empty with no restoration possible. We move the snapshot/clear/
    // restore into the doRebuild closure so all writes are atomic.
  }

  // Collect card files. If manifest defines card_globs, collect files covered by them.
  // Otherwise, fallback to scanning all .md files under .pmem/.
  let cardFiles: string[];
  const cardGlobs = manifest.source_of_truth?.card_globs;
  if (cardGlobs && Array.isArray(cardGlobs)) {
    const filesSet = new Set<string>();
    for (const cardGlob of cardGlobs) {
      const globSuffixIndex = cardGlob.indexOf('/**/');
      const baseDir = globSuffixIndex >= 0
        ? path.join(cwd, cardGlob.substring(0, globSuffixIndex))
        : path.join(cwd, path.dirname(cardGlob));
      if (fs.existsSync(baseDir)) {
        collectMdFiles(baseDir, filesSet);
      }
    }
    // Also include candidates directory if it exists
    const candidatesDir = path.join(pmemPath, 'candidates');
    if (fs.existsSync(candidatesDir)) {
      collectMdFiles(candidatesDir, filesSet);
    }
    cardFiles = Array.from(filesSet).filter(f => {
      const rel = path.relative(pmemPath, f);
      return !['index.md', 'state.md', 'next.md'].includes(rel);
    });
  } else {
    // Scan all .md files under .pmem/, excluding non-card files
    cardFiles = listFiles(pmemPath, /\.md$/).filter(f => {
      const rel = path.relative(pmemPath, f);
      return !['index.md', 'state.md', 'next.md'].includes(rel) &&
             !rel.startsWith('skills/') &&
             !rel.startsWith('integrations/') &&
             !rel.startsWith('summaries/') &&
             !rel.startsWith('indexes/') &&
             !rel.startsWith('backups/');
    });
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let processed = 0;
  let skipped = 0;
  let updated = 0;

  // Wrap all per-card SQLite writes in a single transaction for performance
  const doRebuild = db.transaction(() => {
    if (isFull) {
      // v0.6.4 polish 5 (revised): snapshot active sessions BEFORE
      // clearAllTables, so a mid-transaction crash leaves either the old
      // sessions (rollback) or the new cards + restored sessions (commit).
      // Single transaction = atomic from SQLite's perspective.
      type ActiveSessionRow = {
        id: string;
        agent_name: string | null;
        started_at: string;
        ended_at: string | null;
        task_summary: string | null;
        base_index_hash: string | null;
        status: string | null;
        dirty: number;
      };
      const activeSessions = db
        .prepare("SELECT id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty FROM sessions WHERE ended_at IS NULL")
        .all() as ActiveSessionRow[];
      preservedSessions = activeSessions.length;

      clearAllTables(db);

      if (activeSessions.length > 0) {
        const restore = db.prepare(
          "INSERT INTO sessions (id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const s of activeSessions) {
          restore.run(s.id, s.agent_name, s.started_at, s.ended_at, s.task_summary, s.base_index_hash, s.status, s.dirty);
        }
      }
    }

    for (const file of cardFiles) {
      const parsed = parseCard(file);
      if (!parsed) continue;

      // In --card mode, skip cards that don't match the target ID
      if (isSingleCard && parsed.frontmatter.id !== options.card) continue;

      const relPath = path.relative(cwd, file);
      processed++;

      const fm = parsed.frontmatter;
      const title = extractTitle(parsed.bodyText) || fm.id;

      // Build legacy graph node (always, for backward compat output)
      nodes.push({
        id: fm.id,
        type: fm.type,
        title,
        status: fm.status,
        file: relPath,
        tags: fm.tags,
        aliases: fm.aliases,
      });

      // Build legacy graph edges (always, for backward compat output)
      collectLegacyEdges(fm, edges);

      // Compute content hashes
      const hashes = computeCardHashes(parsed.fullContent, parsed.frontmatterText, parsed.bodyText);

      // In --changed mode, skip cards whose hashes match what's in SQLite
      if (!isFull) {
        const existing = getCardHash(db, relPath);
        if (
          existing &&
          existing.file_hash === hashes.fileHash &&
          existing.frontmatter_hash === hashes.frontmatterHash &&
          existing.body_hash === hashes.bodyHash
        ) {
          // Even if hashes match, backfill updated_at if it's NULL (v0.6.2 time contract)
          const card = db.prepare('SELECT updated_at FROM cards WHERE file_path = ?').get(relPath) as { updated_at: string | null } | undefined;
          if (card && !card.updated_at) {
            db.prepare('UPDATE cards SET updated_at = ? WHERE file_path = ?').run(resolveUpdatedAt(fm.updated, file), relPath);
          }
          skipped++;
          continue;
        }
      }

      updated++;

      const tokCount = tokenCount(parsed.fullContent);
      const secCount = sectionCount(parsed.bodyText);
      const isCandidate = relPath.includes('/candidates/') ? 1 : 0;

      // Build CardRow and upsert
      const cardRow: CardRow = {
        id: fm.id,
        type: fm.type,
        title,
        status: fm.status ?? null,
        priority: fm.priority ?? null,
        file_path: relPath,
        summary: null,
        schema_version: fm.schema_version ?? null,
        card_version: fm.version ?? 1,
        created_at: null,
        updated_at: resolveUpdatedAt(fm.updated, file),
        last_verified_at: fm.last_verified ?? null,
        file_hash: hashes.fileHash,
        frontmatter_hash: hashes.frontmatterHash,
        body_hash: hashes.bodyHash,
        token_count: tokCount,
        section_count: secCount,
        is_deleted: 0,
        is_candidate: isCandidate,
      };

      upsertCard(db, cardRow);

      // Clear existing explicit relations before re-inserting (preserve inferred edges)
      deleteExplicitCardEdges(db, fm.id);
      deleteCardAliases(db, fm.id);
      deleteCardTags(db, fm.id);
      deleteCardPaths(db, fm.id);

      // Re-insert aliases
      if (fm.aliases) {
        for (const alias of fm.aliases) {
          insertAlias(db, fm.id, alias);
        }
      }

      // Re-insert tags
      if (fm.tags) {
        for (const tag of fm.tags) {
          insertTag(db, fm.id, tag);
        }
      }

      // Re-insert source_files as paths
      if (fm.source_files) {
        for (const sf of fm.source_files) {
          insertPath(db, fm.id, sf, 'source_file');
        }
      }

      const now = new Date().toISOString();

      // Insert depends_on edges
      if (fm.depends_on) {
        for (const target of fm.depends_on) {
          const edgeRow: EdgeRow = {
            from_id: fm.id,
            to_id: target,
            type: 'depends_on',
            source: 'explicit',
            confidence: 1.0,
            created_at: now,
            updated_at: now,
          };
          insertEdge(db, edgeRow);
        }
      }

      // Insert related_to edges
      if (fm.related) {
        for (const target of fm.related) {
          const edgeRow: EdgeRow = {
            from_id: fm.id,
            to_id: target,
            type: 'related_to',
            source: 'explicit',
            confidence: 1.0,
            created_at: now,
            updated_at: now,
          };
          insertEdge(db, edgeRow);
        }
      }

      // Derived edges: task type with module.* related → next_step_of
      if (fm.type === 'task' && fm.related) {
        for (const target of fm.related) {
          if (target.startsWith('module.')) {
            const edgeRow: EdgeRow = {
              from_id: fm.id,
              to_id: target,
              type: 'next_step_of',
              source: 'inferred',
              confidence: 0.8,
              created_at: now,
              updated_at: now,
            };
            insertEdge(db, edgeRow);
          }
        }
      }
    }
  });

  // Execute all SQLite writes in a single transaction
  doRebuild();

  // Create FTS5 virtual table for full-text search (outside transaction)
  createFTS5(db);

  // Write legacy graph.json for backward compatibility
  const allContent = cardFiles.map(f => readFile(f) || '').join('');
  const sourceHash = computeHash(allContent);

  const graphIndex: GraphIndex = {
    kind: 'pmem.graph_index',
    pmem_version: manifest.pmem.protocol_version,
    generated_at: new Date().toISOString(),
    source: {
      type: 'markdown_frontmatter',
      glob: '.pmem/**/*.md',
      source_hash: sourceHash,
    },
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  };

  const indexesDir = path.join(pmemPath, 'indexes');
  ensureDir(indexesDir);
  writeJson(path.join(indexesDir, 'graph.json'), graphIndex);

  // Output summary
  const modeLabel = isFull
    ? preservedSessions > 0
      ? `Full rebuild (preserved ${preservedSessions} session${preservedSessions === 1 ? '' : 's'})`
      : 'Full rebuild'
    : isSingleCard
      ? `Single card: ${options.card}`
      : 'Incremental rebuild';
  console.log(`${modeLabel}: ${processed} cards processed, ${skipped} skipped (hash match), ${updated} updated`);
  console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

  closeDatabase();
}

/**
 * Parse a .md memory card file into its constituent parts.
 * Reads the file once, extracts YAML frontmatter (between --- markers),
 * the markdown body, and parses the frontmatter into a CardFrontmatter object.
 */
function parseCard(filePath: string): ParsedCard | null {
  const fullContent = readFile(filePath);
  if (!fullContent) return null;

  const parsed = parseFrontmatter(fullContent);
  if (!parsed) return null;

  const frontmatter = parsed.data as unknown as CardFrontmatter;
  if (!frontmatter.id) return null;

  // Extract frontmatter text for hash computation
  const fmMatch = fullContent.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterText = fmMatch ? fmMatch[1] : '';

  return { fullContent, frontmatterText, bodyText: parsed.body, frontmatter };
}

/** Extract the first # heading from markdown body text as the card title. */
function extractTitle(bodyText: string): string | null {
  const match = bodyText.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** Build legacy GraphEdge entries from a card's frontmatter (for backward-compat graph.json). */
function collectLegacyEdges(fm: CardFrontmatter, edges: GraphEdge[]): void {
  if (fm.depends_on) {
    for (const target of fm.depends_on) {
      edges.push({ from: fm.id, to: target, type: 'depends_on' });
    }
  }
  if (fm.related) {
    for (const target of fm.related) {
      edges.push({ from: fm.id, to: target, type: 'related_to' });
    }
  }
  // Derived edge: task → module
  if (fm.type === 'task' && fm.related) {
    for (const target of fm.related) {
      if (target.startsWith('module.')) {
        edges.push({ from: fm.id, to: target, type: 'next_step_of', derived: true });
      }
    }
  }
}

/**
 * Resolve the updated_at timestamp using the time-source priority chain:
 * 1. frontmatter.updated (user-declared time)
 * 2. file mtime (file system modification time)
 * 3. current rebuild time (final fallback)
 *
 * Returns an ISO 8601 string, never null.
 */
function resolveUpdatedAt(fmUpdated: string | null | undefined, absPath: string): string {
  if (fmUpdated) {
    // Normalize to ISO 8601 — frontmatter may contain non-ISO dates like "2026-05-20"
    const parsed = new Date(fmUpdated);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    // Unparseable date: fall through to mtime
  }
  const mtime = getFileMtime(absPath);
  if (mtime !== null) return new Date(mtime).toISOString();
  return new Date().toISOString();
}

function collectMdFiles(dir: string, results: Set<string>): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMdFiles(fullPath, results);
    } else if (entry.name.endsWith('.md')) {
      results.add(fullPath);
    }
  }
}
