import * as path from 'path';
import * as fs from 'fs';
import { readFile, writeJson, listFiles, ensureDir, fileExists, getFileMtime, withLock, toPosixPath } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openDatabase, createSchema, upsertCard, deleteExplicitCardEdges, deleteMentionEdges, deleteInferredCardEdges, deleteOrphanEdges, insertEdge, deleteCardAliases, insertAlias, deleteCardTags, insertTag, deleteCardPaths, insertPath, clearAllTables, getCardHash, closeDatabase, createFTS5, refreshCardFts, deleteCardFts, cardFtsRowExists, clearCardFts, type CardFtsRow } from '../core/db';
import { computeCardHashes, tokenCount, sectionCount, computeHash } from '../core/hash';
import { parseFrontmatter } from '../core/yaml';
import { acknowledgeStatusChanges } from '../core/query/status';
import type { CardFrontmatter, GraphNode, GraphEdge, GraphIndex, CardRow, EdgeRow } from '../types';

const PMEM_DIR = '.pmem';

interface RebuildOptions {
  changed?: boolean;
  full?: boolean;
  card?: string;
  cwd?: string;
  /** Suppress success summaries when rebuild is an internal command step. */
  silent?: boolean;
}

interface ParsedCard {
  fullContent: string;
  frontmatterText: string;
  bodyText: string;
  frontmatter: CardFrontmatter;
}

type CardParseDiagnosticCode = 'empty_file' | 'invalid_frontmatter' | 'missing_id' | 'missing_type';

type CardParseResult =
  | { ok: true; card: ParsedCard }
  | {
      ok: false;
      diagnostic: {
        filePath: string;
        code: CardParseDiagnosticCode;
        message: string;
        parsedId?: string;
      };
    };

export function rebuildCommand(options: RebuildOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  // v0.7.6 FIX-1 (issue #9): hold `.pmem/.lock` for the duration of the
  // rebuild so a concurrent `pmem verify` waits (or reports `active_lock`)
  // instead of reading a torn-down SQLite index and emitting transient
  // `stale_index` warnings. `withLock` is reentrant — when invoked from
  // `pmem update --confirm` (which already holds the lock) it just runs
  // the body without an extra acquire/release round trip.
  withLock(pmemPath, () => {
    rebuildLocked(pmemPath, options, cwd);
  }, { timeoutMs: 30000, onTimeout: 'error' });
}

/**
 * The actual rebuild body, run inside the `.pmem/.lock` critical section
 * (see FIX-1 in `rebuildCommand`).
 */
function rebuildLocked(pmemPath: string, options: RebuildOptions, cwd: string = process.cwd()): void {
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
  // Core runtime schema is versioned independently in createSchema(). The
  // manifest version remains the source card protocol and should not downgrade
  // the DB schema (events table rebuild behavior is append-only for incremental
  // rebuilds and clear+recreate on --full via clearAllTables()).

  const isFull = options.full === true;
  const isSingleCard = typeof options.card === 'string';

  // Number of active sessions preserved by the --full snapshot+restore
  // (set inside doRebuild transaction, read after).
  let preservedSessions = 0;
  let preservedEdges = 0;

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
      const rel = toPosixPath(path.relative(pmemPath, f));
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
  let snappedEdges: Array<{
    from_id: string;
    to_id: string;
    type: string;
    source: string;
    confidence: number;
    created_at: string | null;
    updated_at: string | null;
  }> = [];

  // v0.8: FTS rows collected during the card loop, written after createFTS5.
  // For skipped (hash-match) cards we still collect so a missing FTS row can
  // be backfilled — the card_fts table did not exist before v0.8.
  const ftsRows: CardFtsRow[] = [];
  const ftsSkippedIds: string[] = [];

  // Parse each file exactly once. The previous two-pass implementation
  // collapsed every parse failure to null and silently skipped it twice.
  const parsedCardFiles = cardFiles.map(file => ({ file, result: parseCard(file) }));
  const parseDiagnostics = parsedCardFiles
    .filter((entry): entry is { file: string; result: Extract<CardParseResult, { ok: false }> } => !entry.result.ok)
    .map(entry => entry.result.diagnostic)
    // Candidate reports are advisory Markdown artifacts, not canonical cards.
    .filter(diagnostic => !toPosixPath(path.relative(pmemPath, diagnostic.filePath)).startsWith('candidates/'))
    .filter(diagnostic => !isSingleCard || diagnostic.parsedId === options.card);

  // Pre-scan all valid card IDs for wikilink validation (so [[card-id]] refs
  // resolve even when the target card hasn't been processed yet).
  const validCardIds = new Set<string>();
  for (const entry of parsedCardFiles) {
    if (entry.result.ok) validCardIds.add(entry.result.card.frontmatter.id);
  }

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

      // v0.7.0-a: snapshot all edges before --full clearAllTables,
      // so manually inserted edges (via SQL) are not silently destroyed.
      // After the rebuild loop re-creates canonical edges from frontmatter
      // and wikilinks, any snapped edge that was NOT re-created will be
      // restored — this preserves manual edges while still allowing the
      // rebuild to clean up stale references.
      type EdgeSnapshot = {
        from_id: string;
        to_id: string;
        type: string;
        source: string;
        confidence: number;
        created_at: string | null;
        updated_at: string | null;
      };
      const allEdges = db
        .prepare("SELECT from_id, to_id, type, source, confidence, created_at, updated_at FROM edges")
        .all() as EdgeSnapshot[];

      clearAllTables(db);

      if (activeSessions.length > 0) {
        const restore = db.prepare(
          "INSERT INTO sessions (id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const s of activeSessions) {
          restore.run(s.id, s.agent_name, s.started_at, s.ended_at, s.task_summary, s.base_index_hash, s.status, s.dirty);
        }
      }

      // Store snapped edges for later restoration (after rebuild loop)
      snappedEdges = allEdges;
    }

    for (const entry of parsedCardFiles) {
      if (!entry.result.ok) continue;
      const file = entry.file;
      const parsed = entry.result.card;

      // In --card mode, skip cards that don't match the target ID
      if (isSingleCard && parsed.frontmatter.id !== options.card) continue;

      const relPath = toPosixPath(path.relative(cwd, file));
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
      collectLegacyEdges(fm, parsed.bodyText, validCardIds, edges);

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
          // v0.8 FTS backfill: card content unchanged, but its FTS row may
          // not exist yet (table introduced in v0.8). Collect for backfill.
          ftsRows.push({
            id: fm.id,
            title,
            summary: extractCardSummary(fm, parsed.bodyText),
            body: parsed.bodyText,
            aliases: fm.aliases ?? [],
            tags: fm.tags ?? [],
          });
          ftsSkippedIds.push(fm.id);
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
        summary: extractCardSummary(fm, parsed.bodyText),
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
        confidence: fm.confidence ?? null,
        superseded_by: fm.superseded_by ?? null,
        classification: fm.classification ?? null,
        trust_label: fm.trust_label ?? null,
        sensitivity: fm.sensitivity ?? null,
      };

      upsertCard(db, cardRow);

      ftsRows.push({
        id: fm.id,
        title,
        summary: cardRow.summary,
        body: parsed.bodyText,
        aliases: fm.aliases ?? [],
        tags: fm.tags ?? [],
      });

      // Clear existing explicit, mention, and inferred relations before
      // re-inserting from the current frontmatter. v0.7.3 (issue #6):
      // inferred edges (e.g. task→module next_step_of) must also be
      // re-derived per card — otherwise an incremental rebuild that
      // re-targets a task's `related` to a different module would
      // leave the stale inferred edge to the old module in place.
      deleteExplicitCardEdges(db, fm.id);
      deleteMentionEdges(db, fm.id);
      deleteInferredCardEdges(db, fm.id);
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

      // Mention edges: [[card-id]] wikilinks in card body → references edges
      const wikilinks = extractWikilinks(parsed.bodyText);
      for (const target of wikilinks) {
        // Only create edges for card IDs that actually exist
        if (validCardIds.has(target) && target !== fm.id) {
          const edgeRow: EdgeRow = {
            from_id: fm.id,
            to_id: target,
            type: 'references',
            source: 'mention',
            confidence: 1.0,
            created_at: now,
            updated_at: now,
          };
          insertEdge(db, edgeRow);
        }
      }
    }
  });

  // Execute all SQLite writes in a single transaction
  doRebuild();

  // v0.7.6-a (issue #12): clean up stale DB cards whose source .md files
  // have been deleted from disk. The rebuild loop only processes files
  // that exist — it never removes DB rows for deleted files — so an
  // incremental rebuild would otherwise dead-loop on `missing_card_file`
  // verify warnings with no way to resolve them short of `--full`.
  //
  // Wrapped in a transaction so a crash mid-cleanup leaves the DB in a
  // consistent state (all-or-nothing per stale card batch).
  let cleanedStaleCards = 0;
  let invalidatedCards = 0;
  {
    const invalidFilePaths = new Set(parseDiagnostics.map(diagnostic => toPosixPath(path.relative(cwd, diagnostic.filePath))));
    const cleanupTx = db.transaction(() => {
      const staleCards = db.prepare("SELECT id, file_path FROM cards WHERE is_deleted = 0").all() as Array<{ id: string; file_path: string }>;
      for (const card of staleCards) {
        const absPath = path.join(cwd, card.file_path);
        const invalid = invalidFilePaths.has(card.file_path);
        if (!fileExists(absPath) || invalid) {
          db.prepare("UPDATE cards SET is_deleted = 1 WHERE id = ?").run(card.id);
          // Bidirectional edge cleanup — covers both outgoing and incoming edges
          // for the deleted card, matching the verify.ts cleanupMissingCards pattern.
          db.prepare("DELETE FROM edges WHERE from_id = ? OR to_id = ?").run(card.id, card.id);
          deleteCardAliases(db, card.id);
          deleteCardTags(db, card.id);
          deleteCardPaths(db, card.id);
          deleteCardFts(db, card.id);
          if (invalid) invalidatedCards++;
          else cleanedStaleCards++;
        }
      }
    });
    cleanupTx();
  }

  // v0.7.3 (issue #6): prune orphan edges after rebuild.
  // v0.7.7 (issue #12): run unconditionally — stale card cleanup above
  // can create new orphan edges even in incremental mode.
  deleteOrphanEdges(db);

  // v0.7.0-a (revised in v0.7.3, issue #6): restore edges that the
  // rebuild loop did not and could not have re-derived. We now
  // restrict restoration to:
  //   - sources the rebuild loop does NOT manage (anything other than
  //     'explicit', 'inferred', 'mention'). These are typically manual
  //     SQL inserts that should survive a full rebuild.
  //   - edges whose both endpoints still exist in the cards table.
  //     Orphan edges (e.g. pointing to a deleted card) are NOT
  //     restored, since they would just be pruned again by
  //     `deleteOrphanEdges` and the user wants them gone.
  // Without these filters, the snapshot+restore step would resurrect
  // every `depends_on` / `related_to` / `next_step_of` edge that the
  // user had just removed from a card's frontmatter — the original
  // root cause of issue #6.
  if (isFull && snappedEdges.length > 0) {
    const restoreEdgeTx = db.transaction(() => {
      // Build a set of currently-existing card IDs so the restore loop
      // can skip edges whose endpoints no longer exist.
      const existingCardIds = new Set<string>(
        (db.prepare("SELECT id FROM cards WHERE is_deleted = 0").all() as Array<{ id: string }>).map(r => r.id)
      );

      // Build set of current edge keys: "from_id|to_id|type|source"
      const currentKeys = new Set<string>();
      const currentEdges = db.prepare(
        "SELECT from_id, to_id, type, source FROM edges"
      ).all() as Array<{ from_id: string; to_id: string; type: string; source: string }>;
      for (const e of currentEdges) {
        currentKeys.add(`${e.from_id}|${e.to_id}|${e.type}|${e.source}`);
      }

      // Sources managed by the rebuild loop — restoring any of these
      // would re-introduce the very stale edges we just deleted from
      // the loop's deleteExplicitCardEdges/deleteMentionEdges/
      // deleteInferredCardEdges pass.
      const managedSources = new Set(['explicit', 'inferred', 'mention']);

      const restoreStmt = db.prepare(
        "INSERT OR IGNORE INTO edges (from_id, to_id, type, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      let restoredCount = 0;
      const now = new Date().toISOString();
      for (const e of snappedEdges) {
        // Skip managed sources — they should be re-derived from
        // current frontmatter, not resurrected from the snapshot.
        if (managedSources.has(e.source)) continue;
        // Skip orphan edges — both endpoints must still be cards.
        if (!existingCardIds.has(e.from_id) || !existingCardIds.has(e.to_id)) continue;
        const key = `${e.from_id}|${e.to_id}|${e.type}|${e.source}`;
        if (currentKeys.has(key)) continue;
        restoreStmt.run(
          e.from_id, e.to_id, e.type, e.source, e.confidence,
          e.created_at ?? now, e.updated_at ?? now
        );
        restoredCount++;
      }
      if (restoredCount > 0) {
        preservedEdges = restoredCount;
      }
    });
    restoreEdgeTx();
  }

  // Create FTS5 virtual table for full-text search (outside transaction)
  createFTS5(db);

  // v0.8: populate FTS index. Updated cards always refresh; skipped cards
  // only backfill when their FTS row is missing. Full rebuild starts clean.
  {
    const ftsSkipped = new Set(ftsSkippedIds);
    const ftsTx = db.transaction(() => {
      if (isFull) clearCardFts(db);
      for (const row of ftsRows) {
        if (!isFull && ftsSkipped.has(row.id) && cardFtsRowExists(db, row.id)) continue;
        refreshCardFts(db, row);
      }
    });
    ftsTx();
  }

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

  // Only successfully parsed cards are acknowledged. Invalid files remain
  // pending so status continues to signal that user action is required.
  acknowledgeStatusChanges(
    pmemPath,
    parsedCardFiles
      .filter((entry): entry is { file: string; result: Extract<CardParseResult, { ok: true }> } => entry.result.ok)
      .filter(entry => !isSingleCard || entry.result.card.frontmatter.id === options.card)
      .map(entry => toPosixPath(path.relative(cwd, entry.file))),
  );

  for (const diagnostic of parseDiagnostics) {
    console.log(`Warning: skipped ${toPosixPath(path.relative(cwd, diagnostic.filePath))}: ${diagnostic.message}`);
  }

  // Output summary
  const preservedParts: string[] = [];
  if (preservedSessions > 0) preservedParts.push(`${preservedSessions} session${preservedSessions === 1 ? '' : 's'}`);
  if (preservedEdges > 0) preservedParts.push(`${preservedEdges} edge${preservedEdges === 1 ? '' : 's'}`);
  const preservedLabel = preservedParts.length > 0 ? ` (preserved ${preservedParts.join(', ')})` : '';

  const modeLabel = isFull
    ? `Full rebuild${preservedLabel}`
    : isSingleCard
      ? `Single card: ${options.card}`
      : 'Incremental rebuild';

  // Count actual edges from the SQLite edges table (includes explicit + inferred + mention)
  const dbEdgeCount = (db.prepare("SELECT COUNT(*) as cnt FROM edges").get() as { cnt: number }).cnt;

  if (!options.silent) {
    console.log(`${modeLabel}: ${processed} cards processed, ${skipped} skipped (hash match), ${updated} updated`);
    console.log(`Graph: ${nodes.length} nodes, ${dbEdgeCount} edges`);
    if (cleanedStaleCards > 0) {
      console.log(`Cleaned ${cleanedStaleCards} stale card(s) (source files deleted)`);
    }
    if (invalidatedCards > 0) {
      console.log(`Invalidated ${invalidatedCards} stale indexed card(s) whose source files are invalid`);
    }
  }

  closeDatabase();
}

/**
 * Parse a .md memory card file into its constituent parts.
 * Reads the file once, extracts YAML frontmatter (between --- markers),
 * the markdown body, and parses the frontmatter into a CardFrontmatter object.
 */
function parseCard(filePath: string): CardParseResult {
  let fullContent: string | null;
  try {
    fullContent = readFile(filePath);
  } catch (error: any) {
    return {
      ok: false,
      diagnostic: {
        filePath,
        code: 'empty_file',
        message: `file could not be read (${error?.message ?? String(error)})`,
      },
    };
  }
  if (!fullContent) {
    return {
      ok: false,
      diagnostic: { filePath, code: 'empty_file', message: 'file is empty or unreadable' },
    };
  }

  const parsed = parseFrontmatter(fullContent);
  if (!parsed) {
    return {
      ok: false,
      diagnostic: { filePath, code: 'invalid_frontmatter', message: 'missing or malformed YAML frontmatter' },
    };
  }

  const frontmatter = parsed.data as unknown as CardFrontmatter;
  const parsedId = typeof frontmatter.id === 'string' ? frontmatter.id.trim() : '';
  if (!parsedId) {
    return {
      ok: false,
      diagnostic: { filePath, code: 'missing_id', message: 'missing required frontmatter field "id"' },
    };
  }
  if (typeof frontmatter.type !== 'string' || !frontmatter.type.trim()) {
    return {
      ok: false,
      diagnostic: {
        filePath,
        code: 'missing_type',
        message: 'missing required frontmatter field "type"',
        parsedId,
      },
    };
  }
  frontmatter.id = parsedId;
  frontmatter.type = frontmatter.type.trim();

  // Extract frontmatter text for hash computation
  const fmMatch = fullContent.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterText = fmMatch ? fmMatch[1] : '';

  return { ok: true, card: { fullContent, frontmatterText, bodyText: parsed.body, frontmatter } };
}

/** Extract the first # heading from markdown body text as the card title. */
function extractTitle(bodyText: string): string | null {
  const match = bodyText.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Extract [[card-id]] wikilink references from markdown body text.
 * Matches standard pmem card ID patterns: type.name (e.g. [[character.zero]],
 * [[module.auth]], [[decision.jwt_tokens]]).
 * Returns deduplicated array of card IDs.
 */
export function extractWikilinks(bodyText: string): string[] {
  const wikilinkPattern = /\[\[([a-z][a-z0-9._-]+)\]\]/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = wikilinkPattern.exec(bodyText)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/** Build legacy GraphEdge entries from a card's frontmatter (for backward-compat graph.json). */
function collectLegacyEdges(fm: CardFrontmatter, bodyText: string, validCardIds: Set<string>, edges: GraphEdge[]): void {
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
  // Wikilink edges: [[card-id]] in body → references
  const wikilinks = extractWikilinks(bodyText);
  for (const target of wikilinks) {
    if (validCardIds.has(target) && target !== fm.id) {
      edges.push({ from: fm.id, to: target, type: 'references', derived: false });
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

function extractCardSummary(fm: any, bodyText: string): string | null {
  if (fm.summary) return String(fm.summary);

  const lines = bodyText.split('\n');
  let inSection = false;
  const summaryLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const currentSection = line.substring(3).trim().toLowerCase();
      if (currentSection === 'summary' || currentSection === 'purpose') {
        inSection = true;
      } else {
        inSection = false;
      }
    } else if (inSection) {
      summaryLines.push(line);
    }
  }

  const extracted = summaryLines.join('\n').trim();
  if (extracted) {
    const clean = extracted.split('\n')
      .map(x => x.trim().replace(/^[-*]\s*/, ''))
      .filter(Boolean)[0];
    if (clean) return clean;
  }

  const bodyParagraphs = bodyText.split('\n\n')
    .map(p => p.trim())
    .filter(p => p && !p.startsWith('#') && !p.startsWith('<!--'));
  
  if (bodyParagraphs.length > 0) {
    const firstP = bodyParagraphs[0].replace(/[\r\n]+/g, ' ').trim();
    if (firstP.length > 100) {
      return firstP.slice(0, 97) + '...';
    }
    return firstP;
  }

  return null;
}
