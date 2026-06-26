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
exports.updateStateRecentChanges = updateStateRecentChanges;
exports.updateStateModules = updateStateModules;
const path = __importStar(require("path"));
const fs_1 = require("./fs");
const db_1 = require("./db");
function updateStateRecentChanges(pmemPath, traceSummary) {
    const statePath = path.join(pmemPath, 'state.md');
    if (!(0, fs_1.fileExists)(statePath))
        return;
    const content = (0, fs_1.readFile)(statePath) || '';
    const lines = content.split('\n');
    const newLines = [];
    let inRecentChanges = false;
    const existingChanges = [];
    for (const line of lines) {
        if (line.trim().startsWith('## Recent Changes')) {
            inRecentChanges = true;
            newLines.push(line);
            continue;
        }
        else if (inRecentChanges && line.trim().startsWith('## ')) {
            inRecentChanges = false;
        }
        if (inRecentChanges) {
            if (line.trim().startsWith('-')) {
                existingChanges.push(line.trim());
            }
        }
        else {
            newLines.push(line);
        }
    }
    // Prepend the new change
    const today = new Date().toISOString().split('T')[0];
    const newEntry = `- ${today}: ${traceSummary.summary}`;
    existingChanges.unshift(newEntry);
    // Keep last 10 changes
    const slicedChanges = existingChanges.slice(0, 10);
    // Insert them back
    const rcIndex = newLines.findIndex(l => l.trim().startsWith('## Recent Changes'));
    if (rcIndex >= 0) {
        newLines.splice(rcIndex + 1, 0, '', ...slicedChanges);
    }
    else {
        newLines.push('', '## Recent Changes', '', ...slicedChanges);
    }
    (0, fs_1.writeFile)(statePath, newLines.join('\n').trim() + '\n');
}
function updateStateModules(pmemPath) {
    const statePath = path.join(pmemPath, 'state.md');
    if (!(0, fs_1.fileExists)(statePath))
        return;
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath))
        return;
    let modules = [];
    try {
        const db = (0, db_1.openDatabase)(pmemPath);
        (0, db_1.createSchema)(db);
        const rows = db.prepare("SELECT id, status, updated_at FROM cards WHERE type = 'module' AND is_deleted = 0").all();
        modules = rows.map(r => {
            const name = r.id.replace('module.', '');
            const status = r.status || 'active';
            const updated = r.updated_at ? r.updated_at.split('T')[0] : '-';
            return { name, status, updated };
        });
    }
    catch {
        return;
    }
    if (modules.length === 0)
        return;
    const content = (0, fs_1.readFile)(statePath) || '';
    const lines = content.split('\n');
    const newLines = [];
    let inModules = false;
    for (const line of lines) {
        if (line.trim().startsWith('## Modules')) {
            inModules = true;
            newLines.push(line);
            continue;
        }
        else if (inModules && line.trim().startsWith('## ')) {
            inModules = false;
        }
        if (!inModules) {
            newLines.push(line);
        }
    }
    // Generate table
    const tableLines = [
        '| Module | Status | Last Updated |',
        '|--------|--------|--------------|',
        ...modules.map(m => `| ${m.name} | ${m.status} | ${m.updated} |`)
    ];
    const mIndex = newLines.findIndex(l => l.trim().startsWith('## Modules'));
    if (mIndex >= 0) {
        newLines.splice(mIndex + 1, 0, '', ...tableLines);
    }
    else {
        // Put before Recent Changes if possible
        const rcIndex = newLines.findIndex(l => l.trim().startsWith('## Recent Changes'));
        if (rcIndex >= 0) {
            newLines.splice(rcIndex, 0, '## Modules', '', ...tableLines, '');
        }
        else {
            newLines.push('', '## Modules', '', ...tableLines);
        }
    }
    (0, fs_1.writeFile)(statePath, newLines.join('\n').trim() + '\n');
}
//# sourceMappingURL=state.js.map