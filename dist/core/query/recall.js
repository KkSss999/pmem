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
exports.recallQuery = recallQuery;
const path = __importStar(require("path"));
const fs_1 = require("../fs");
const db_1 = require("../db");
const manifest_1 = require("../manifest");
const PMEM_DIR = '.pmem';
function recallQuery(pmemPath, options) {
    const indexContent = (0, fs_1.readFile)(path.join(pmemPath, 'index.md'));
    const stateContent = (0, fs_1.readFile)(path.join(pmemPath, 'state.md'));
    const nextContent = (0, fs_1.readFile)(path.join(pmemPath, 'next.md'));
    if (!indexContent) {
        throw new Error('No .pmem/index.md found. Run `pmem init` first.');
    }
    const projectName = extractField(indexContent, 'Name:');
    const projectStage = extractField(indexContent, 'Stage:');
    const currentFocus = extractField(indexContent, 'Current Focus');
    const stateLines = [];
    if (stateContent) {
        const lines = stateContent.split('\n');
        let inSection = false;
        for (const line of lines) {
            if (line.startsWith('## ')) {
                inSection = !line.includes('Overall Status');
            }
            else if (inSection && line.trim().startsWith('-')) {
                stateLines.push(line.trim());
            }
        }
    }
    const nextStep = nextContent
        ? extractField(nextContent, '## Recommended Next Step')
        : 'No next step recorded.';
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    const config = manifest ? (0, manifest_1.resolveConfig)(manifest) : { foundational_types: ['module'] };
    const foundationalTypes = config.foundational_types;
    const result = {
        project: projectName || 'Unknown',
        stage: projectStage || undefined,
        focus: currentFocus || 'No focus recorded.',
        state: stateLines,
        next: nextStep || 'No next step recorded.',
        mustRead: [],
        dirty_flags_count: 0,
        recent_updates: [],
        active_modules: [],
        active_foundation: [],
    };
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        result.mustRead.push('.pmem/state.md');
        result.mustRead.push('.pmem/next.md');
        return result;
    }
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    let sinceThreshold = null;
    if (options?.since) {
        sinceThreshold = parseSince(options.since);
        if (sinceThreshold === null) {
            throw new Error(`Invalid --since format: "${options.since}". Use <N>h, <N>d, or <N>w (e.g. 24h, 7d, 1w).`);
        }
    }
    const activeCards = sinceThreshold
        ? db.prepare("SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0 AND updated_at >= ?").all(sinceThreshold)
        : db.prepare("SELECT * FROM cards WHERE is_deleted = 0 AND is_candidate = 0").all();
    const foundationalCards = activeCards.filter(c => foundationalTypes.includes(c.type));
    result.active_foundation = foundationalCards.map(c => c.file_path);
    result.active_modules = result.active_foundation;
    result.mustRead.push('.pmem/state.md');
    result.mustRead.push('.pmem/next.md');
    for (const card of foundationalCards.slice(0, 5)) {
        result.mustRead.push(card.file_path);
    }
    const dirtyFlagResult = db.prepare("SELECT COUNT(*) as count FROM dirty_flags WHERE resolved_at IS NULL").get();
    result.dirty_flags_count = dirtyFlagResult.count;
    const recentUpdates = db.prepare("SELECT action, summary, created_at FROM update_log ORDER BY created_at DESC LIMIT 5").all();
    result.recent_updates = recentUpdates;
    if (result.mustRead.length === 0) {
        result.mustRead.push('.pmem/state.md');
        result.mustRead.push('.pmem/next.md');
    }
    return result;
}
function extractField(content, fieldName) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(fieldName)) {
            const val = line.split(fieldName)[1]?.trim();
            if (val)
                return val;
            if (i + 1 < lines.length && lines[i + 1].trim()) {
                return lines[i + 1].trim();
            }
        }
    }
    return null;
}
function parseSince(since) {
    const match = since.match(/^(\d+)([hdw])$/);
    if (!match)
        return null;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'h' ? value * 3600000
        : unit === 'd' ? value * 86400000
            : unit === 'w' ? value * 604800000
                : 0;
    if (ms === 0)
        return null;
    return new Date(Date.now() - ms).toISOString();
}
//# sourceMappingURL=recall.js.map