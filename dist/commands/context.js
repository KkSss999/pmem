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
exports.contextCommand = contextCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const context_1 = require("../core/query/context");
function contextCommand(task, options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.error('Error: No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    const budget = options.budget ? Number(options.budget) : 4000;
    const format = options.format || 'compact';
    // 1. Run core context query
    const result = (0, context_1.contextQuery)(pmemPath, task, budget);
    // 2. Save task metadata to session.json
    const sessionPath = path.join(pmemPath, 'session.json');
    const sessionData = {
        latest_task: task,
        latest_context_query: task,
        latest_context_cards: result.relevant_memory.map(c => c.id),
        updated_at: new Date().toISOString()
    };
    try {
        (0, fs_1.writeFile)(sessionPath, JSON.stringify(sessionData, null, 2));
    }
    catch (err) {
        console.error(`Warning: Failed to save session metadata: ${err.message}`);
    }
    // 3. Print output based on format
    if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        // Beautiful human/agent readable Markdown output
        console.log(`# PMEM_CONTEXT_READY: ${task}`);
        console.log('');
        console.log(`- **Project Stage**: ${result.project_stage || 'Not recorded'}`);
        console.log(`- **Current Focus**: ${result.current_focus}`);
        console.log('');
        console.log('## Suggested Reads');
        for (const item of result.must_read) {
            console.log(`- [${path.basename(item.path)}](file://${path.resolve(item.path)}) — ${item.reason}`);
        }
        console.log('');
        if (result.relevant_memory.length > 0) {
            console.log('## Relevant Memory Cards');
            for (const card of result.relevant_memory) {
                console.log(`- **${card.id}** (${card.type}): [${card.title}](file://${path.resolve(card.file_path)})`);
                if (card.summary) {
                    console.log(`  > ${card.summary}`);
                }
            }
            console.log('');
        }
        if (result.changed_files.length > 0) {
            console.log('## Changed Files');
            for (const file of result.changed_files) {
                console.log(`- [${file.path}](file://${path.resolve(file.path)}) [${file.status}]`);
            }
            console.log('');
        }
        if (result.warnings.length > 0) {
            console.log('## Warnings / Status');
            for (const warning of result.warnings) {
                console.log(`- ${warning}`);
            }
            console.log('');
        }
        console.log('## Recommended Next Action');
        console.log(result.recommended_next_action);
    }
}
//# sourceMappingURL=context.js.map