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
exports.statusCommand = statusCommand;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("../core/fs");
const db_1 = require("../core/db");
const git_1 = require("../core/git");
const manifest_1 = require("../core/manifest");
const MATCH_PRIORITY = {
    exact: 3,
    directory: 2,
    graph_neighbor: 1,
};
// === Helper ===
function upsertAffectedCard(map, card) {
    const existing = map.get(card.card_id);
    if (!existing || MATCH_PRIORITY[card.match_type] > MATCH_PRIORITY[existing.match_type]) {
        map.set(card.card_id, card);
    }
}
function formatAffectedCardDetail(ac) {
    switch (ac.match_type) {
        case 'exact':
            return `exact: ${ac.matched_file}`;
        case 'directory':
            return `directory: ${ac.matched_dir}`;
        case 'graph_neighbor':
            return `graph_neighbor via ${ac.via_card}`;
        default:
            return ac.match_type;
    }
}
// === Main command ===
function statusCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    const format = (options.format || 'compact');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    // Detect changes
    const source = detectChangesFrom();
    const changes = getChangedFiles(cwd, options.since);
    // Open database
    let db = null;
    const dbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
        }
        catch { /* DB may be locked or corrupt */ }
    }
    const affectedCards = new Map();
    // === Pass 1: Exact path matching (per file) ===
    for (const change of changes) {
        if (!db)
            continue;
        try {
            const rows = db.prepare("SELECT card_id, path FROM paths WHERE ? LIKE '%' || path || '%'").all(change.path);
            for (const row of rows) {
                change.relatedCards.push({ card_id: row.card_id, match_type: 'exact' });
                upsertAffectedCard(affectedCards, {
                    card_id: row.card_id,
                    match_type: 'exact',
                    matched_file: change.path,
                });
            }
        }
        catch { /* ignore query errors */ }
    }
    // === Pass 2: Directory-level fuzzy matching ===
    // Collect unique directories from changed files, then query each once
    if (db) {
        const dirSet = new Set();
        for (const change of changes) {
            const dir = path.dirname(change.path);
            if (dir && dir !== '.') {
                dirSet.add(dir);
            }
        }
        for (const dir of dirSet) {
            try {
                const dirPattern = dir + '/%';
                const dirRows = db.prepare("SELECT card_id, path FROM paths WHERE path LIKE ?").all(dirPattern);
                for (const row of dirRows) {
                    upsertAffectedCard(affectedCards, {
                        card_id: row.card_id,
                        match_type: 'directory',
                        matched_dir: dir + '/',
                    });
                }
            }
            catch { /* ignore query errors */ }
        }
    }
    // === Pass 3: Graph neighbor expansion (one-hop) ===
    if (db && affectedCards.size > 0) {
        const affectedCardIds = [...affectedCards.keys()];
        const placeholders = affectedCardIds.map(() => '?').join(',');
        try {
            const edgeRows = db.prepare(`SELECT from_id, to_id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).all(...affectedCardIds, ...affectedCardIds);
            for (const edge of edgeRows) {
                // from_id is affected, to_id is the neighbor
                if (affectedCards.has(edge.from_id) && !affectedCards.has(edge.to_id)) {
                    upsertAffectedCard(affectedCards, {
                        card_id: edge.to_id,
                        match_type: 'graph_neighbor',
                        via_card: edge.from_id,
                    });
                }
                // to_id is affected, from_id is the neighbor
                if (affectedCards.has(edge.to_id) && !affectedCards.has(edge.from_id)) {
                    upsertAffectedCard(affectedCards, {
                        card_id: edge.from_id,
                        match_type: 'graph_neighbor',
                        via_card: edge.to_id,
                    });
                }
            }
        }
        catch { /* ignore query errors */ }
    }
    if (db)
        (0, db_1.closeDatabase)();
    // === Output ===
    const affectedCardsList = [...affectedCards.values()];
    if (format === 'json') {
        console.log(JSON.stringify({
            checked_at: new Date().toISOString(),
            source,
            changes: changes.map(c => ({
                path: c.path,
                status: c.status,
                related_cards: c.relatedCards.map(rc => ({
                    card_id: rc.card_id,
                    match_type: rc.match_type,
                })),
            })),
            affected_cards: affectedCardsList.map(ac => {
                const obj = { card_id: ac.card_id, match_type: ac.match_type };
                if (ac.matched_file)
                    obj.matched_file = ac.matched_file;
                if (ac.matched_dir)
                    obj.matched_dir = ac.matched_dir;
                if (ac.via_card)
                    obj.via_card = ac.via_card;
                return obj;
            }),
            suggested_action: affectedCards.size > 0 ? 'pmem mark-dirty --auto' : null,
        }, null, 2));
    }
    else {
        // compact output
        console.log(`Changed files (${changes.length}) [${source}]:`);
        for (const c of changes) {
            const related = c.relatedCards.length > 0
                ? c.relatedCards.map(rc => `${rc.card_id} (${rc.match_type})`).join(', ')
                : '(no related cards)';
            console.log(`  ${c.status} ${c.path} → related: ${related}`);
        }
        if (affectedCards.size > 0) {
            console.log(`\nAffected cards (${affectedCards.size}):`);
            for (const ac of affectedCardsList) {
                console.log(`  ${ac.card_id} (${formatAffectedCardDetail(ac)})`);
            }
            console.log(`\nRun: pmem mark-dirty --auto`);
        }
    }
    // Exit code: always 0 for normal operation.
    // Exit 1 no longer used as "no changes" workflow signal (v0.6.2).
    // Exit 2 reserved for runtime errors (missing DB, corrupt files, etc.).
}
// === Change detection ===
function detectChangesFrom() {
    try {
        (0, child_process_1.execSync)('git rev-parse --git-dir', { stdio: 'ignore' });
        return 'git';
    }
    catch {
        return 'mtime';
    }
}
function getChangedFiles(cwd, since) {
    const changes = [];
    const pmemPath = path.join(cwd, '.pmem');
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    const config = manifest ? (0, manifest_1.resolveConfig)(manifest) : null;
    const userSkipDirs = manifest?.change_detection?.skip_dirs || [];
    const systemSkips = [
        'node_modules', '.git', 'dist', 'build', '.claude',
        '.pmem/pmem.db', '.pmem/indexes', '.pmem/.lock',
        '.pmem/skills', '.pmem/candidates', '.pmem/summaries',
        '.pmem/.last-status'
    ];
    // Backward compatibility: if not a schema-based project, keep old behavior
    const skipDirs = manifest && manifest.schema
        ? Array.from(new Set([...userSkipDirs, ...systemSkips]))
        : ['node_modules', '.git', '.pmem', 'dist', 'build', '.claude'];
    try {
        const source = detectChangesFrom();
        if (source === 'git') {
            const output = (0, child_process_1.execSync)('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 });
            for (const change of (0, git_1.parseGitStatusPorcelain)(output)) {
                // Skip ignored directories
                if (skipDirs.some(d => change.path.startsWith(d + '/') || change.path === d))
                    continue;
                changes.push({ path: change.path, status: change.status || 'M', relatedCards: [] });
            }
            return changes;
        }
    }
    catch { /* fall through to mtime */ }
    // Mtime-based fallback
    const lastStatusFile = path.join(cwd, '.pmem', '.last-status');
    const lastCheck = since ? new Date(since).getTime() : ((0, fs_1.getFileMtime)(lastStatusFile) || 0);
    const defaultScanDirs = ['src', 'lib', 'app', 'tests'];
    const mtimeScanDirs = manifest?.change_detection?.mtime_scan_dirs || defaultScanDirs;
    // 1. Scan default/custom source directories
    for (const dir of mtimeScanDirs) {
        const dirPath = path.join(cwd, dir);
        if (!(0, fs_1.fileExists)(dirPath))
            continue;
        scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
    }
    // 2. Scan card directories under .pmem
    if (config) {
        for (const dir of Object.values(config.type_dirs)) {
            const dirPath = path.join(cwd, '.pmem', dir);
            if (!(0, fs_1.fileExists)(dirPath))
                continue;
            scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
        }
    }
    // Update .last-status
    (0, fs_1.writeFile)(lastStatusFile, new Date().toISOString());
    return changes;
}
function scanDirMtime(dirPath, cwd, since, skipDirs, changes) {
    const fs = require('fs');
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relPath = path.relative(cwd, fullPath);
            if (skipDirs.some(d => relPath.startsWith(d + '/') || relPath === d))
                continue;
            if (entry.isDirectory()) {
                scanDirMtime(fullPath, cwd, since, skipDirs, changes);
            }
            else if (entry.isFile()) {
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.mtimeMs > since) {
                        changes.push({ path: relPath, status: 'M', relatedCards: [] });
                    }
                }
                catch { /* skip */ }
            }
        }
    }
    catch { /* skip */ }
}
//# sourceMappingURL=status.js.map