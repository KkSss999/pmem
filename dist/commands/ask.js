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
exports.askCommand = askCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const db_1 = require("../core/db");
const format_1 = require("../core/format");
const manifest_1 = require("../core/manifest");
const PMEM_DIR = '.pmem';
function askCommand(query, format = 'compact') {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    if (!(0, fs_1.fileExists)(dbPath)) {
        console.log('No SQLite database found. Run `pmem rebuild` first.');
        return;
    }
    let db;
    try {
        db = (0, db_1.openDatabase)(pmemPath);
        (0, db_1.createSchema)(db);
    }
    catch (err) {
        if (err?.message?.includes('not a valid SQLite database')) {
            console.log(err.message);
            return;
        }
        console.log(`Failed to open database: ${err?.message || err}`);
        console.log('Run `pmem rebuild --full` to rebuild the database.');
        return;
    }
    const normalizedQuery = query.toLowerCase().trim();
    const queryTokens = tokenize(normalizedQuery);
    const matches = [];
    const seenIds = new Set();
    // Step 1: Exact match — card ID
    const idMatches = db.prepare("SELECT * FROM cards WHERE (id = ? OR id LIKE ?) AND is_deleted = 0").all(normalizedQuery, `%${normalizedQuery}%`);
    for (const card of idMatches) {
        if (seenIds.has(card.id))
            continue;
        seenIds.add(card.id);
        matches.push({
            id: card.id,
            title: card.title,
            match_type: card.id === normalizedQuery ? 'exact_id' : 'exact_title',
            confidence: card.id === normalizedQuery ? 0.95 : 0.85,
            graph_distance: 0,
            file: card.file_path,
        });
    }
    // Step 2: Exact match — aliases
    const aliasMatches = db.prepare(`SELECT c.* FROM cards c
     JOIN aliases a ON c.id = a.card_id
     WHERE (a.normalized_alias = ? OR a.normalized_alias LIKE ?)
       AND c.is_deleted = 0`).all(normalizedQuery, `%${normalizedQuery}%`);
    for (const card of aliasMatches) {
        if (seenIds.has(card.id))
            continue;
        seenIds.add(card.id);
        matches.push({
            id: card.id,
            title: card.title,
            match_type: 'alias',
            confidence: 0.9,
            graph_distance: 0,
            file: card.file_path,
        });
    }
    // Step 3: Exact match — tags
    const tagMatches = db.prepare(`SELECT c.* FROM cards c
     JOIN tags t ON c.id = t.card_id
     WHERE t.normalized_tag = ?
       AND c.is_deleted = 0`).all(normalizedQuery);
    for (const card of tagMatches) {
        if (seenIds.has(card.id))
            continue;
        seenIds.add(card.id);
        matches.push({
            id: card.id,
            title: card.title,
            match_type: 'tag',
            confidence: 0.7,
            graph_distance: 0,
            file: card.file_path,
        });
    }
    // Also try tag matching with individual query tokens
    for (const token of queryTokens) {
        const tokenTagMatches = db.prepare(`SELECT c.* FROM cards c
       JOIN tags t ON c.id = t.card_id
       WHERE t.normalized_tag LIKE ?
         AND c.is_deleted = 0`).all(`%${token}%`);
        for (const card of tokenTagMatches) {
            if (seenIds.has(card.id))
                continue;
            seenIds.add(card.id);
            matches.push({
                id: card.id,
                title: card.title,
                match_type: 'tag',
                confidence: 0.6,
                graph_distance: 0,
                file: card.file_path,
            });
        }
    }
    // Step 4: Graph expansion — 1-hop neighbors from matched cards
    const matchedIdsAtThisPoint = new Set(matches.map(m => m.id));
    for (const match of matches) {
        const edges = db.prepare("SELECT * FROM edges WHERE from_id = ? OR to_id = ?").all(match.id, match.id);
        for (const edge of edges) {
            const neighborId = edge.from_id === match.id ? edge.to_id : edge.from_id;
            if (matchedIdsAtThisPoint.has(neighborId) || seenIds.has(neighborId))
                continue;
            seenIds.add(neighborId);
            const neighborCard = db.prepare("SELECT * FROM cards WHERE id = ? AND is_deleted = 0").get(neighborId);
            if (neighborCard) {
                matches.push({
                    id: neighborCard.id,
                    title: neighborCard.title,
                    match_type: 'graph_expansion',
                    confidence: 0.6,
                    graph_distance: 1,
                    file: neighborCard.file_path,
                    edge_type: edge.type,
                    from_card: match.id,
                });
            }
        }
    }
    // Step 5: Keyword fallback — FTS5 if available, else LIKE
    if (matches.filter(m => m.match_type !== 'graph_expansion').length === 0) {
        // Filter out expansions for the "no direct matches" check
        const directMatchesBeforeFallback = matches.filter(m => m.match_type !== 'graph_expansion');
        if (directMatchesBeforeFallback.length === 0) {
            if ((0, db_1.hasFTS5)(db)) {
                try {
                    const ftsResults = db.prepare("SELECT c.*, rank FROM card_fts JOIN cards c ON card_fts.card_id = c.id WHERE card_fts MATCH ? AND c.is_deleted = 0 ORDER BY rank").all(normalizedQuery);
                    for (const row of ftsResults) {
                        if (seenIds.has(row.id))
                            continue;
                        seenIds.add(row.id);
                        matches.push({
                            id: row.id,
                            title: row.title,
                            match_type: 'keyword_fallback',
                            confidence: Math.min(0.5, 1 / (1 + (row.rank || 1))),
                            graph_distance: 0,
                            file: row.file_path,
                        });
                    }
                }
                catch {
                    // FTS5 query failed, fall through to LIKE fallback
                }
            }
            // LIKE fallback (used if FTS5 unavailable or FTS5 returned no results)
            if (matches.filter(m => m.match_type === 'keyword_fallback').length === 0) {
                const likePattern = `%${normalizedQuery}%`;
                const likeResults = db.prepare("SELECT * FROM cards WHERE (title LIKE ? OR summary LIKE ?) AND is_deleted = 0").all(likePattern, likePattern);
                for (const card of likeResults) {
                    if (seenIds.has(card.id))
                        continue;
                    seenIds.add(card.id);
                    // Simple relevance: count token overlap in title
                    const titleLower = card.title.toLowerCase();
                    const tokenOverlap = queryTokens.filter(t => titleLower.includes(t)).length;
                    matches.push({
                        id: card.id,
                        title: card.title,
                        match_type: 'keyword_fallback',
                        confidence: Math.min(0.5, tokenOverlap / Math.max(1, queryTokens.length)),
                        graph_distance: 0,
                        file: card.file_path,
                    });
                }
            }
        }
    }
    // Step 6: Rerank
    const typeOrder = {
        exact_id: 5,
        exact_title: 4,
        alias: 3,
        tag: 2,
        graph_expansion: 1,
        keyword_fallback: 0,
    };
    matches.sort((a, b) => {
        return ((typeOrder[b.match_type] - typeOrder[a.match_type]) ||
            (b.confidence - a.confidence) ||
            (a.graph_distance - b.graph_distance));
    });
    // Step 7: Deduplicate (keep first/highest-ranked match per id)
    const dedupedIds = new Set();
    const deduped = [];
    for (const m of matches) {
        if (dedupedIds.has(m.id))
            continue;
        dedupedIds.add(m.id);
        deduped.push(m);
    }
    // Build recommended_files and evidence_paths
    const recommendedFiles = [];
    for (const m of deduped.slice(0, 8)) {
        recommendedFiles.push(m.file);
    }
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    const config = manifest ? (0, manifest_1.resolveConfig)(manifest) : { evidence_types: ['decision', 'trace'] };
    const evidenceTypes = config.evidence_types;
    const evidencePaths = [];
    for (const m of deduped) {
        const card = db.prepare("SELECT type, file_path FROM cards WHERE id = ? AND is_deleted = 0").get(m.id);
        if (card && evidenceTypes.includes(card.type)) {
            evidencePaths.push(card.file_path);
        }
    }
    const result = {
        query,
        matched: deduped,
        recommended_files: recommendedFiles,
        evidence_paths: evidencePaths,
    };
    // Build guidance for empty results
    const askMessage = deduped.length > 0
        ? `Found ${deduped.length} match(es).`
        : 'No matching memory cards found.';
    const askNextSteps = deduped.length > 0 ? [] : [
        'Try a different query keyword',
        'Run `pmem recall` for full project context',
        'Check that cards have relevant aliases and tags',
    ];
    // Output
    if (format === 'json') {
        console.log(JSON.stringify({
            ...result,
            message: askMessage,
            next_steps: askNextSteps,
        }, null, 2));
    }
    else {
        // Adapt to formatOutput's expected shape
        const formatCompat = {
            query: result.query,
            matched: result.matched.map(m => ({
                id: m.id,
                title: m.title,
                matchType: m.match_type,
                match_type: m.match_type,
                confidence: m.confidence,
                graphDistance: m.graph_distance,
                graph_distance: m.graph_distance,
                file: m.file,
                edgeType: m.edge_type,
                edge_type: m.edge_type,
                fromCard: m.from_card,
            })),
            recommended_files: result.recommended_files,
            evidencePaths: result.evidence_paths,
        };
        console.log((0, format_1.formatOutput)(formatCompat, format, 2000));
    }
}
function tokenize(text) {
    const tokens = [];
    const words = text.split(/[\s,，。、；;：:！!？?()（）\[\]【】{}]+/);
    for (const word of words) {
        if (word.length === 0)
            continue;
        if (/[一-鿿]/.test(word)) {
            const cjkChars = word.match(/[一-鿿]/g) || [];
            tokens.push(...cjkChars);
            const nonCjk = word.replace(/[一-鿿]/g, '').trim();
            if (nonCjk)
                tokens.push(nonCjk.toLowerCase());
        }
        else {
            tokens.push(word.toLowerCase());
        }
    }
    return [...new Set(tokens)];
}
//# sourceMappingURL=ask.js.map