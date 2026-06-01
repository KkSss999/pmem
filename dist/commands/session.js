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
exports.sessionStartCommand = sessionStartCommand;
exports.sessionEndCommand = sessionEndCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const db_1 = require("../core/db");
const PMEM_DIR = '.pmem';
function sessionStartCommand(agentName) {
    const pmemPath = path.join(process.cwd(), PMEM_DIR);
    // 1. Check .pmem/ exists
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    // Check DB file exists
    if (!(0, fs_1.fileExists)(path.join(pmemPath, 'pmem.db'))) {
        console.log('No SQLite database found. Run `pmem rebuild` first.');
        return;
    }
    // 2. Open SQLite DB, createSchema
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    // 3. Check if there's already an active session
    const active = (0, db_1.getActiveSession)(db);
    if (active) {
        console.log(`Active session already exists: ${active.id}. End it first with \`pmem session end\`.`);
        (0, db_1.closeDatabase)();
        return;
    }
    // 4. Generate session ID: "session-YYYYMMDD-HHmmss"
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
    const sessionId = `session-${dateStr}-${timeStr}`;
    // 5. Call startSession
    (0, db_1.startSession)(db, sessionId, agentName);
    // 6. Print
    console.log(`Session started: ${sessionId}`);
    if (agentName) {
        console.log(`  Agent: ${agentName}`);
    }
    console.log('  Run `pmem session end` when done.');
    // 7. closeDatabase
    (0, db_1.closeDatabase)();
}
function sessionEndCommand(taskSummary) {
    const pmemPath = path.join(process.cwd(), PMEM_DIR);
    // 1. Check .pmem/ exists
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    // Check DB file exists
    if (!(0, fs_1.fileExists)(path.join(pmemPath, 'pmem.db'))) {
        console.log('No SQLite database found. Run `pmem rebuild` first.');
        return;
    }
    // 2. Open DB, createSchema
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    // 3. Get active session
    const active = (0, db_1.getActiveSession)(db);
    // 4. If no active session
    if (!active) {
        console.log('No active pmem session found.');
        console.log('Next: run `pmem session start -a "<agent-name>"` to begin a session.');
        console.log('If this is expected (e.g., work was done without a formal session), run `pmem update --confirm` directly to record changes.');
        (0, db_1.closeDatabase)();
        return;
    }
    // 5. Call endSession
    (0, db_1.endSession)(db, active.id, 'completed', taskSummary);
    // 6. Query session update log for summary
    const logs = db.prepare("SELECT action, summary, created_at, success, affected_cards FROM update_log WHERE session_id = ? ORDER BY created_at").all(active.id);
    // Count actions by type
    let updateCount = 0, traceCount = 0, errorCount = 0;
    const allAffected = new Set();
    for (const log of logs) {
        if (!log.success) {
            errorCount++;
            continue;
        }
        if (log.action === 'confirm_update')
            updateCount++;
        if (log.action === 'create_trace')
            traceCount++;
        if (log.affected_cards) {
            try {
                const cards = JSON.parse(log.affected_cards);
                cards.forEach(c => allAffected.add(c));
            }
            catch { }
        }
    }
    // Query unresolved dirty flags for this session
    const dirtyFlags = db.prepare("SELECT scope, target, reason FROM dirty_flags WHERE session_id = ? AND resolved_at IS NULL").all(active.id);
    // Print summary
    console.log(`Session ended: ${active.id}`);
    if (taskSummary)
        console.log(`  Summary: ${taskSummary}`);
    console.log(`  Actions: ${updateCount} update(s), ${traceCount} trace(s) created${errorCount > 0 ? `, ${errorCount} error(s)` : ''}`);
    if (allAffected.size > 0) {
        console.log(`  Cards affected: ${[...allAffected].join(', ')}`);
    }
    if (dirtyFlags.length > 0) {
        console.log(`  Unresolved dirty flags: ${dirtyFlags.length}`);
        for (const df of dirtyFlags) {
            console.log(`    [${df.scope}] ${df.target}: ${df.reason}`);
        }
    }
    console.log(`\nRun: pmem verify`);
    // 7. closeDatabase
    (0, db_1.closeDatabase)();
}
//# sourceMappingURL=session.js.map