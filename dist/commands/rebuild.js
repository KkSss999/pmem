"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebuildCommand = rebuildCommand;
exports.extractWikilinks = extractWikilinks;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const db_1 = require("../core/db");
const hash_1 = require("../core/hash");
const yaml_1 = require("../core/yaml");
const PMEM_DIR = '.pmem';
function rebuildCommand(options = {}) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        if ((0, fs_1.fileExists)(pmemPath)) {
            console.log('.pmem/manifest.yml not found. Run `pmem init` to regenerate the manifest, or restore it from backup.');
        }
        else {
            console.log('No .pmem directory found. Run `pmem init` first.');
        }
        return;
    }
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    (0, db_1.setSchemaVersion)(db, manifest.pmem.schema_version);
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
    let cardFiles;
    const cardGlobs = manifest.source_of_truth?.card_globs;
    if (cardGlobs && Array.isArray(cardGlobs)) {
        const filesSet = new Set();
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
    }
    else {
        // Scan all .md files under .pmem/, excluding non-card files
        cardFiles = (0, fs_1.listFiles)(pmemPath, /\.md$/).filter(f => {
            const rel = path.relative(pmemPath, f);
            return !['index.md', 'state.md', 'next.md'].includes(rel) &&
                !rel.startsWith('skills/') &&
                !rel.startsWith('integrations/') &&
                !rel.startsWith('summaries/') &&
                !rel.startsWith('indexes/') &&
                !rel.startsWith('backups/');
        });
    }
    const nodes = [];
    const edges = [];
    let processed = 0;
    let skipped = 0;
    let updated = 0;
    // Pre-scan all card IDs for wikilink validation (so [[card-id]] refs
    // resolve even when the target card hasn't been processed yet)
    const validCardIds = new Set();
    for (const file of cardFiles) {
        const parsed = parseCard(file);
        if (parsed)
            validCardIds.add(parsed.frontmatter.id);
    }
    // Wrap all per-card SQLite writes in a single transaction for performance
    const doRebuild = db.transaction(() => {
        if (isFull) {
            const activeSessions = db
                .prepare("SELECT id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty FROM sessions WHERE ended_at IS NULL")
                .all();
            preservedSessions = activeSessions.length;
            (0, db_1.clearAllTables)(db);
            if (activeSessions.length > 0) {
                const restore = db.prepare("INSERT INTO sessions (id, agent_name, started_at, ended_at, task_summary, base_index_hash, status, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                for (const s of activeSessions) {
                    restore.run(s.id, s.agent_name, s.started_at, s.ended_at, s.task_summary, s.base_index_hash, s.status, s.dirty);
                }
            }
        }
        for (const file of cardFiles) {
            const parsed = parseCard(file);
            if (!parsed)
                continue;
            // In --card mode, skip cards that don't match the target ID
            if (isSingleCard && parsed.frontmatter.id !== options.card)
                continue;
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
            collectLegacyEdges(fm, parsed.bodyText, validCardIds, edges);
            // Compute content hashes
            const hashes = (0, hash_1.computeCardHashes)(parsed.fullContent, parsed.frontmatterText, parsed.bodyText);
            // In --changed mode, skip cards whose hashes match what's in SQLite
            if (!isFull) {
                const existing = (0, db_1.getCardHash)(db, relPath);
                if (existing &&
                    existing.file_hash === hashes.fileHash &&
                    existing.frontmatter_hash === hashes.frontmatterHash &&
                    existing.body_hash === hashes.bodyHash) {
                    // Even if hashes match, backfill updated_at if it's NULL (v0.6.2 time contract)
                    const card = db.prepare('SELECT updated_at FROM cards WHERE file_path = ?').get(relPath);
                    if (card && !card.updated_at) {
                        db.prepare('UPDATE cards SET updated_at = ? WHERE file_path = ?').run(resolveUpdatedAt(fm.updated, file), relPath);
                    }
                    skipped++;
                    continue;
                }
            }
            updated++;
            const tokCount = (0, hash_1.tokenCount)(parsed.fullContent);
            const secCount = (0, hash_1.sectionCount)(parsed.bodyText);
            const isCandidate = relPath.includes('/candidates/') ? 1 : 0;
            // Build CardRow and upsert
            const cardRow = {
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
            (0, db_1.upsertCard)(db, cardRow);
            // Clear existing explicit and mention relations before re-inserting (preserve inferred edges)
            (0, db_1.deleteExplicitCardEdges)(db, fm.id);
            (0, db_1.deleteMentionEdges)(db, fm.id);
            (0, db_1.deleteCardAliases)(db, fm.id);
            (0, db_1.deleteCardTags)(db, fm.id);
            (0, db_1.deleteCardPaths)(db, fm.id);
            // Re-insert aliases
            if (fm.aliases) {
                for (const alias of fm.aliases) {
                    (0, db_1.insertAlias)(db, fm.id, alias);
                }
            }
            // Re-insert tags
            if (fm.tags) {
                for (const tag of fm.tags) {
                    (0, db_1.insertTag)(db, fm.id, tag);
                }
            }
            // Re-insert source_files as paths
            if (fm.source_files) {
                for (const sf of fm.source_files) {
                    (0, db_1.insertPath)(db, fm.id, sf, 'source_file');
                }
            }
            const now = new Date().toISOString();
            // Insert depends_on edges
            if (fm.depends_on) {
                for (const target of fm.depends_on) {
                    const edgeRow = {
                        from_id: fm.id,
                        to_id: target,
                        type: 'depends_on',
                        source: 'explicit',
                        confidence: 1.0,
                        created_at: now,
                        updated_at: now,
                    };
                    (0, db_1.insertEdge)(db, edgeRow);
                }
            }
            // Insert related_to edges
            if (fm.related) {
                for (const target of fm.related) {
                    const edgeRow = {
                        from_id: fm.id,
                        to_id: target,
                        type: 'related_to',
                        source: 'explicit',
                        confidence: 1.0,
                        created_at: now,
                        updated_at: now,
                    };
                    (0, db_1.insertEdge)(db, edgeRow);
                }
            }
            // Derived edges: task type with module.* related → next_step_of
            if (fm.type === 'task' && fm.related) {
                for (const target of fm.related) {
                    if (target.startsWith('module.')) {
                        const edgeRow = {
                            from_id: fm.id,
                            to_id: target,
                            type: 'next_step_of',
                            source: 'inferred',
                            confidence: 0.8,
                            created_at: now,
                            updated_at: now,
                        };
                        (0, db_1.insertEdge)(db, edgeRow);
                    }
                }
            }
            // Mention edges: [[card-id]] wikilinks in card body → references edges
            const wikilinks = extractWikilinks(parsed.bodyText);
            for (const target of wikilinks) {
                // Only create edges for card IDs that actually exist
                if (validCardIds.has(target) && target !== fm.id) {
                    const edgeRow = {
                        from_id: fm.id,
                        to_id: target,
                        type: 'references',
                        source: 'mention',
                        confidence: 1.0,
                        created_at: now,
                        updated_at: now,
                    };
                    (0, db_1.insertEdge)(db, edgeRow);
                }
            }
        }
    });
    // Execute all SQLite writes in a single transaction
    doRebuild();
    // Create FTS5 virtual table for full-text search (outside transaction)
    (0, db_1.createFTS5)(db);
    // Write legacy graph.json for backward compatibility
    const allContent = cardFiles.map(f => (0, fs_1.readFile)(f) || '').join('');
    const sourceHash = (0, hash_1.computeHash)(allContent);
    const graphIndex = {
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
    (0, fs_1.ensureDir)(indexesDir);
    (0, fs_1.writeJson)(path.join(indexesDir, 'graph.json'), graphIndex);
    // Output summary
    const modeLabel = isFull
        ? preservedSessions > 0
            ? `Full rebuild (preserved ${preservedSessions} session${preservedSessions === 1 ? '' : 's'})`
            : 'Full rebuild'
        : isSingleCard
            ? `Single card: ${options.card}`
            : 'Incremental rebuild';
    // Count actual edges from the SQLite edges table (includes explicit + inferred + mention)
    const dbEdgeCount = db.prepare("SELECT COUNT(*) as cnt FROM edges").get().cnt;
    console.log(`${modeLabel}: ${processed} cards processed, ${skipped} skipped (hash match), ${updated} updated`);
    console.log(`Graph: ${nodes.length} nodes, ${dbEdgeCount} edges`);
    (0, db_1.closeDatabase)();
}
/**
 * Parse a .md memory card file into its constituent parts.
 * Reads the file once, extracts YAML frontmatter (between --- markers),
 * the markdown body, and parses the frontmatter into a CardFrontmatter object.
 */
function parseCard(filePath) {
    const fullContent = (0, fs_1.readFile)(filePath);
    if (!fullContent)
        return null;
    const parsed = (0, yaml_1.parseFrontmatter)(fullContent);
    if (!parsed)
        return null;
    const frontmatter = parsed.data;
    if (!frontmatter.id)
        return null;
    // Extract frontmatter text for hash computation
    const fmMatch = fullContent.match(/^---\n([\s\S]*?)\n---/);
    const frontmatterText = fmMatch ? fmMatch[1] : '';
    return { fullContent, frontmatterText, bodyText: parsed.body, frontmatter };
}
/** Extract the first # heading from markdown body text as the card title. */
function extractTitle(bodyText) {
    const match = bodyText.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}
/**
 * Extract [[card-id]] wikilink references from markdown body text.
 * Matches standard pmem card ID patterns: type.name (e.g. [[character.zero]],
 * [[module.auth]], [[decision.jwt_tokens]]).
 * Returns deduplicated array of card IDs.
 */
function extractWikilinks(bodyText) {
    const wikilinkPattern = /\[\[([a-z][a-z0-9._-]+)\]\]/g;
    const ids = new Set();
    let match;
    while ((match = wikilinkPattern.exec(bodyText)) !== null) {
        ids.add(match[1]);
    }
    return Array.from(ids);
}
/** Build legacy GraphEdge entries from a card's frontmatter (for backward-compat graph.json). */
function collectLegacyEdges(fm, bodyText, validCardIds, edges) {
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
function resolveUpdatedAt(fmUpdated, absPath) {
    if (fmUpdated) {
        // Normalize to ISO 8601 — frontmatter may contain non-ISO dates like "2026-05-20"
        const parsed = new Date(fmUpdated);
        if (!isNaN(parsed.getTime()))
            return parsed.toISOString();
        // Unparseable date: fall through to mtime
    }
    const mtime = (0, fs_1.getFileMtime)(absPath);
    if (mtime !== null)
        return new Date(mtime).toISOString();
    return new Date().toISOString();
}
function collectMdFiles(dir, results) {
    if (!fs.existsSync(dir))
        return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectMdFiles(fullPath, results);
        }
        else if (entry.name.endsWith('.md')) {
            results.add(fullPath);
        }
    }
}
//# sourceMappingURL=rebuild.js.map