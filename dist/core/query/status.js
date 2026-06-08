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
exports.statusQuery = statusQuery;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("../fs");
const db_1 = require("../db");
const git_1 = require("../git");
const manifest_1 = require("../manifest");
const MATCH_PRIORITY = {
    exact: 3,
    directory: 2,
    graph_neighbor: 1,
};
function statusQuery(pmemPath, options) {
    const cwd = process.cwd();
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        throw new Error('No .pmem directory found. Run `pmem init` first.');
    }
    const source = detectChangesFrom();
    const changes = getChangedFiles(pmemPath, cwd, options?.since);
    const affectedCards = new Map();
    if ((0, fs_1.fileExists)(dbPath)) {
        const db = (0, db_1.openDatabase)(pmemPath);
        (0, db_1.createSchema)(db);
        // Pass 1: Exact path matching
        try {
            const allPaths = db.prepare("SELECT card_id, path FROM paths").all();
            for (const change of changes) {
                for (const p of allPaths) {
                    if ((0, fs_1.isPathMatch)(change.path, p.path)) {
                        change.related_cards.push({ card_id: p.card_id, match_type: 'exact' });
                        upsertAffectedCard(affectedCards, {
                            card_id: p.card_id,
                            match_type: 'exact',
                            matched_file: change.path,
                        });
                    }
                }
            }
        }
        catch { /* ignore query errors */ }
        // Pass 2: Directory-level fuzzy matching
        try {
            const dirSet = new Set();
            for (const change of changes) {
                const dir = path.dirname(change.path);
                if (dir && dir !== '.') {
                    dirSet.add(dir);
                }
            }
            for (const dir of dirSet) {
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
        }
        catch { /* ignore query errors */ }
        // Pass 3: Graph neighbor expansion (one-hop)
        if (affectedCards.size > 0) {
            const affectedCardIds = [...affectedCards.keys()];
            const placeholders = affectedCardIds.map(() => '?').join(',');
            try {
                const edgeRows = db.prepare(`SELECT from_id, to_id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).all(...affectedCardIds, ...affectedCardIds);
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
            }
            catch { /* ignore query errors */ }
        }
    }
    const affectedCardsList = [...affectedCards.values()];
    return {
        checked_at: new Date().toISOString(),
        source,
        changes: changes.map(c => ({
            path: c.path,
            status: c.status,
            related_cards: c.related_cards,
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
    };
}
function upsertAffectedCard(map, card) {
    const existing = map.get(card.card_id);
    if (!existing || MATCH_PRIORITY[card.match_type] > MATCH_PRIORITY[existing.match_type]) {
        map.set(card.card_id, card);
    }
}
function detectChangesFrom() {
    try {
        (0, child_process_1.execSync)('git rev-parse --git-dir', { stdio: 'ignore' });
        return 'git';
    }
    catch {
        return 'mtime';
    }
}
function getChangedFiles(pmemPath, cwd, since) {
    const changes = [];
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    const config = manifest ? (0, manifest_1.resolveConfig)(manifest) : null;
    const userSkipDirs = manifest?.change_detection?.skip_dirs || [];
    const systemSkips = [
        'node_modules', '.git', 'dist', 'build', '.claude',
        '.pmem/pmem.db', '.pmem/indexes', '.pmem/.lock',
        '.pmem/skills', '.pmem/candidates', '.pmem/summaries',
        '.pmem/.last-status'
    ];
    const skipDirs = manifest && manifest.schema
        ? Array.from(new Set([...userSkipDirs, ...systemSkips]))
        : ['node_modules', '.git', '.pmem', 'dist', 'build', '.claude'];
    try {
        const source = detectChangesFrom();
        if (source === 'git') {
            const output = (0, child_process_1.execSync)('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 });
            for (const change of (0, git_1.parseGitStatusPorcelain)(output)) {
                if (skipDirs.some(d => change.path.startsWith(d + '/') || change.path === d))
                    continue;
                changes.push({ path: change.path, status: change.status || 'M', related_cards: [] });
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
    for (const dir of mtimeScanDirs) {
        const dirPath = path.join(cwd, dir);
        if (!(0, fs_1.fileExists)(dirPath))
            continue;
        scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
    }
    if (config) {
        for (const dir of Object.values(config.type_dirs)) {
            const dirPath = path.join(cwd, '.pmem', dir);
            if (!(0, fs_1.fileExists)(dirPath))
                continue;
            scanDirMtime(dirPath, cwd, lastCheck, skipDirs, changes);
        }
    }
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
                        changes.push({ path: relPath, status: 'M', related_cards: [] });
                    }
                }
                catch { /* skip */ }
            }
        }
    }
    catch { /* skip */ }
}
//# sourceMappingURL=status.js.map