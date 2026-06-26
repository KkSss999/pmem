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
exports.checkStaleMemory = checkStaleMemory;
const path = __importStar(require("path"));
const fs_1 = require("fs");
const fs_2 = require("./fs");
const db_1 = require("./db");
/**
 * Check for stale memory: cards whose source_files have been modified
 * after the card was last updated or verified.
 *
 * Shared between verify.ts and update.ts so that verify/suggest
 * semantics stay aligned.
 */
function checkStaleMemory(pmemPath) {
    const cwd = process.cwd();
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_2.fileExists)(dbPath)) {
        return [];
    }
    let db;
    try {
        db = (0, db_1.openDatabase)(pmemPath);
    }
    catch {
        return [];
    }
    const issues = [];
    try {
        const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all();
        for (const card of cards) {
            if (card.type === 'trace')
                continue;
            const sourceFiles = db.prepare("SELECT p.path FROM paths p WHERE p.card_id = ? AND p.relation = 'source_file'").all(card.id);
            const t1 = card.updated_at ? new Date(card.updated_at).getTime() : 0;
            const t2 = card.last_verified_at ? new Date(card.last_verified_at).getTime() : 0;
            const cardUpdatedMs = Math.max(t1, t2);
            if (cardUpdatedMs === 0)
                continue;
            for (const sourceFile of sourceFiles) {
                // Skip .pmem/ self-references: pmem update --confirm rewrites
                // manifest.yml / next.md / state.md / index.md, which would
                // immediately trigger false-positive stale_memory on the next
                // verify for any card whose source_files list .pmem/ entries.
                if (sourceFile.path.startsWith('.pmem/') || sourceFile.path === '.pmem')
                    continue;
                const absPath = path.join(cwd, sourceFile.path);
                if (!(0, fs_2.fileExists)(absPath))
                    continue;
                try {
                    const sourceStat = (0, fs_1.statSync)(absPath);
                    if (sourceStat.mtimeMs > cardUpdatedMs) {
                        issues.push({
                            type: 'stale_memory',
                            severity: 'blocking',
                            card_id: card.id,
                            file_path: sourceFile.path,
                            message: `${card.id} may be stale — ${sourceFile.path} modified after last card update`,
                        });
                    }
                }
                catch {
                    // skip files that can't be stat'd
                }
            }
        }
    }
    finally {
        // Don't close the DB — it may be reused by the caller
    }
    return issues;
}
//# sourceMappingURL=consistency.js.map