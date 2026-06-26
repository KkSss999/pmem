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
exports.contextQuery = contextQuery;
const path = __importStar(require("path"));
const fs_1 = require("../fs");
const db_1 = require("../db");
const recall_1 = require("./recall");
const ask_1 = require("./ask");
const status_1 = require("./status");
function contextQuery(pmemPath, task, budget = 4000) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    // Set up defaults
    const result = {
        task,
        project_stage: undefined,
        current_focus: 'No focus recorded.',
        must_read: [
            { path: '.pmem/state.md', reason: 'Overall project stage and status' },
            { path: '.pmem/next.md', reason: 'Recommended next steps from last update' }
        ],
        relevant_memory: [],
        changed_files: [],
        dirty_memory: [],
        warnings: [],
        recommended_next_action: 'Read the suggested files to understand the context, then proceed with your task. Run pmem capture when done.'
    };
    if (!(0, fs_1.fileExists)(pmemPath)) {
        result.warnings.push('No .pmem directory found. Run pmem init first.');
        return result;
    }
    // 1. Recall
    try {
        const recall = (0, recall_1.recallQuery)(pmemPath, { budget });
        result.project_name = recall.project;
        result.project_stage = recall.stage;
        result.current_focus = recall.focus;
        if (recall.architecture) {
            result.current_architecture = recall.architecture.map(m => {
                const sum = m.summary ? ` — ${m.summary}` : '';
                return `${m.id}${sum}`;
            });
        }
        if (recall.recent_traces) {
            result.recent_session_memory = recall.recent_traces.map(t => t.summary);
        }
        const decsSet = new Set();
        const lowercaseDecs = new Set();
        const addDecision = (val) => {
            const trimmed = val.trim();
            if (!trimmed)
                return;
            const lower = trimmed.toLowerCase();
            if (!lowercaseDecs.has(lower)) {
                lowercaseDecs.add(lower);
                decsSet.add(trimmed);
            }
        };
        if (recall.decisions) {
            for (const d of recall.decisions) {
                addDecision(`${d.title}${d.summary ? ` — ${d.summary}` : ''}`);
            }
        }
        if (recall.recent_traces) {
            for (const t of recall.recent_traces) {
                for (const d of t.decisions) {
                    addDecision(d);
                }
            }
        }
        result.relevant_decisions = Array.from(decsSet);
    }
    catch (err) {
        result.warnings.push(`Recall query failed: ${err.message}`);
    }
    // 2. Ask (Task-Aware)
    let askMatched = [];
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            const ask = (0, ask_1.askQuery)(pmemPath, task);
            askMatched = ask.matched || [];
        }
        catch (err) {
            result.warnings.push(`Ask query failed: ${err.message}`);
        }
    }
    else {
        result.warnings.push('No SQLite database found. Run pmem rebuild first.');
    }
    // 3. Status
    try {
        const status = (0, status_1.statusQuery)(pmemPath);
        result.changed_files = (status.changes || []).map(c => ({
            path: c.path,
            status: c.status
        }));
    }
    catch (err) {
        result.warnings.push(`Status query failed: ${err.message}`);
    }
    // Database-dependent context enrichment
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
            // Populate relevant_memory with titles and summaries
            for (const m of askMatched.slice(0, 10)) {
                const card = db.prepare("SELECT type, title, summary, file_path FROM cards WHERE id = ? AND is_deleted = 0").get(m.id);
                if (card) {
                    result.relevant_memory.push({
                        id: m.id,
                        title: card.title,
                        file_path: card.file_path,
                        summary: card.summary || undefined,
                        type: card.type
                    });
                }
            }
            // Populate must_read with details of foundational cards
            const activeFoundationPaths = result.relevant_memory
                .slice(0, 3)
                .map(c => c.file_path);
            for (const fpath of activeFoundationPaths) {
                if (!result.must_read.some(r => r.path === fpath)) {
                    const card = db.prepare("SELECT type, id FROM cards WHERE file_path = ? AND is_deleted = 0").get(fpath);
                    if (card) {
                        result.must_read.push({
                            path: fpath,
                            reason: `Task-relevant memory card: ${card.id} (${card.type})`
                        });
                    }
                }
            }
            // Populate dirty_memory
            const dirtyFlags = db.prepare("SELECT target, reason FROM dirty_flags WHERE resolved_at IS NULL").all();
            result.dirty_memory = dirtyFlags.map(df => df.target);
            if (dirtyFlags.length > 0) {
                result.warnings.push(`There are ${dirtyFlags.length} unresolved dirty flags. Remember to run pmem capture --auto when done.`);
            }
        }
        catch (err) {
            result.warnings.push(`Database context query enrichment failed: ${err.message}`);
        }
        finally {
            (0, db_1.closeDatabase)();
        }
    }
    // Generate recommended next action
    if (result.changed_files.length > 0) {
        const filesToRead = result.relevant_memory.slice(0, 2).map(c => c.file_path);
        const filesStr = filesToRead.length > 0 ? `Read ${filesToRead.join(', ')} first. ` : '';
        result.recommended_next_action = `${filesStr}You have modified files. Review the suggested reads to see if their cards need updates, then run pmem capture when done.`;
    }
    else {
        const filesToRead = result.relevant_memory.slice(0, 2).map(c => c.file_path);
        const filesStr = filesToRead.length > 0 ? `Read ${filesToRead.join(', ')} first. ` : '';
        result.recommended_next_action = `${filesStr}Read the suggested files to understand the context, then proceed with your task. Run pmem capture when done.`;
    }
    return result;
}
//# sourceMappingURL=context.js.map