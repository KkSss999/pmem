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
exports.syncCommand = syncCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const rebuild_1 = require("./rebuild");
const db_1 = require("../core/db");
const status_1 = require("./status");
const next_1 = require("../core/next");
function syncCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    // Backup file states for atomicity / rollback
    const manifestPath = path.join(pmemPath, 'manifest.yml');
    const dirtyPath = path.join(pmemPath, '.dirty');
    const nextPath = path.join(pmemPath, 'next.md');
    const manifestBackup = (0, fs_1.fileExists)(manifestPath) ? (0, fs_1.readFile)(manifestPath) : null;
    const dirtyBackup = (0, fs_1.fileExists)(dirtyPath) ? (0, fs_1.readFile)(dirtyPath) : null;
    const nextBackup = (0, fs_1.fileExists)(nextPath) ? (0, fs_1.readFile)(nextPath) : null;
    const dbPath = path.join(pmemPath, 'pmem.db');
    let db = null;
    let transactionActive = false;
    let createdTracePath = null;
    try {
        // 1. Detect changes
        const changes = (0, status_1.getChangedFiles)(cwd);
        if (changes.length === 0) {
            console.log('No changed files detected. Memory is up-to-date.');
            return;
        }
        // 2. Mark dirty
        if (!(0, fs_1.fileExists)(dbPath)) {
            throw new Error('SQLite database not found. Run pmem rebuild first.');
        }
        db = (0, db_1.openDatabase)(pmemPath);
        (0, db_1.createSchema)(db);
        // Start SQLite transaction
        db.prepare('BEGIN TRANSACTION').run();
        transactionActive = true;
        const activeSession = (0, db_1.getActiveSession)(db);
        const dirtyCards = [];
        // Retrieve all paths for precise relative path matching
        const allPaths = db.prepare("SELECT card_id, path FROM paths").all();
        for (const change of changes) {
            for (const p of allPaths) {
                if ((0, fs_1.isPathMatch)(change.path, p.path)) {
                    if (!dirtyCards.includes(p.card_id)) {
                        (0, db_1.insertDirtyFlag)(db, 'card', p.card_id, 'file_changed: ' + change.path, activeSession?.id);
                        dirtyCards.push(p.card_id);
                    }
                }
            }
        }
        // Update manifest dirty state & write .dirty file
        const manifest = (0, manifest_1.loadManifest)(pmemPath);
        const timestamp = new Date().toISOString();
        if (dirtyCards.length > 0 && manifest) {
            manifest.memory_status.dirty = true;
            manifest.memory_status.dirty_reason = `auto_sync: ${dirtyCards.length} cards dirty`;
            manifest.memory_status.dirty_since = timestamp;
            (0, manifest_1.saveManifest)(pmemPath, manifest);
            (0, fs_1.atomicWrite)(dirtyPath, `reason: auto_sync: ${dirtyCards.length} cards dirty\nsince: ${timestamp}\n`);
            (0, db_1.insertDirtyFlag)(db, 'project', '.pmem', `auto_sync: ${dirtyCards.length} cards dirty`, activeSession?.id);
        }
        // 3. Confirm update if summary is provided
        if (options.summary) {
            if (options.next) {
                (0, next_1.writeManagedNext)(pmemPath, {
                    nextStep: options.next,
                    why: 'Confirmed during sync.',
                    context: ['Run `pmem recall` for full context.']
                });
            }
            const today = new Date().toISOString().split('T')[0];
            const traceDir = path.join(pmemPath, 'traces');
            (0, fs_1.ensureDir)(traceDir);
            const fs = require('fs');
            const existingTraces = fs.readdirSync(traceDir)
                .filter((f) => f.startsWith(today))
                .length;
            const traceNum = String(existingTraces + 1).padStart(3, '0');
            createdTracePath = path.join(traceDir, `${today}-${traceNum}.md`);
            (0, fs_1.atomicWrite)(createdTracePath, `---\nid: trace.${today}-${traceNum}\ntype: trace\ncreated: ${today}\n---\n\n# Trace: ${options.summary}\n\n## What Changed\n${options.summary}\n\n## Next\n${options.next || 'Continue as planned.'}\n`);
            // Resolve project level dirty flag and log update
            (0, db_1.resolveDirtyFlags)(db, 'project', '.pmem');
            (0, db_1.insertUpdateLog)(db, 'confirm_update', options.summary, activeSession?.id, [`trace.${today}-${traceNum}`], true);
            // Clean up dirty state in files
            if ((0, fs_1.fileExists)(dirtyPath)) {
                fs.unlinkSync(dirtyPath);
            }
            if (manifest) {
                manifest.memory_status.dirty = false;
                manifest.memory_status.dirty_reason = null;
                manifest.memory_status.dirty_since = null;
                (0, manifest_1.saveManifest)(pmemPath, manifest);
            }
        }
        // Commit SQLite transaction
        db.prepare('COMMIT').run();
        transactionActive = false;
        (0, db_1.closeDatabase)();
        // Rebuild index and output sync status
        if (options.summary) {
            console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
            if (createdTracePath) {
                const relativeTrace = path.relative(cwd, createdTracePath);
                console.log(`Trace written: ${relativeTrace}`);
            }
            console.log('Rebuilding indexes...');
            (0, rebuild_1.rebuildCommand)();
            console.log('\n✓ Memory sync and update completed.');
        }
        else {
            if (dirtyCards.length > 0) {
                console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
                console.log('\nRecommended: run `pmem sync -s "<summary>" -n "<next>"` to confirm and sync memory.');
            }
            else {
                console.log('No related cards found for changed files.');
            }
        }
    }
    catch (err) {
        console.error('Error during pmem sync:', err.message);
        // Rollback SQLite transaction
        if (db && transactionActive) {
            try {
                db.prepare('ROLLBACK').run();
            }
            catch (rollbackErr) {
                // ignore
            }
        }
        try {
            (0, db_1.closeDatabase)();
        }
        catch { }
        // Rollback files
        const fs = require('fs');
        if (manifestBackup !== null) {
            (0, fs_1.writeFile)(manifestPath, manifestBackup);
        }
        if (dirtyBackup !== null) {
            (0, fs_1.writeFile)(dirtyPath, dirtyBackup);
        }
        else if ((0, fs_1.fileExists)(dirtyPath)) {
            try {
                fs.unlinkSync(dirtyPath);
            }
            catch { }
        }
        if (nextBackup !== null) {
            (0, fs_1.writeFile)(nextPath, nextBackup);
        }
        else if ((0, fs_1.fileExists)(nextPath)) {
            try {
                fs.unlinkSync(nextPath);
            }
            catch { }
        }
        if (createdTracePath && (0, fs_1.fileExists)(createdTracePath)) {
            try {
                fs.unlinkSync(createdTracePath);
            }
            catch { }
        }
        console.log('Rollback completed cleanly.');
        process.exit(2);
    }
}
//# sourceMappingURL=sync.js.map