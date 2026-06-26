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
exports.buildTraceSummary = buildTraceSummary;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const symbols_1 = require("./symbols");
const fs_1 = require("./fs");
const db_1 = require("./db");
const MODULE_HINTS = {
    engine: ['engine', 'loop', 'gameLoop', 'state', 'physics', 'collision'],
    renderer: ['renderer', 'canvas', 'draw', 'sprite', 'scene'],
    audio: ['audio', 'sound', 'music', 'sfx'],
    ui: ['App.jsx', 'components', 'styles', 'css', 'layout'],
    api: ['api', 'client', 'server', 'routes'],
    storage: ['db', 'sqlite', 'storage', 'repo'],
    config: ['config', 'vite', 'webpack', 'tsconfig'],
    tests: ['test', 'spec', '__tests__']
};
const DECISION_KEYWORDS = [
    'decide', 'decision', 'use', 'adopt', 'choose', 'switch', 'keep', 'stabilize', 'fixed',
    '决定', '采用', '固定', '改为', '放弃', '暂时不', '保持', '迁移到', '选择', '不用'
];
function buildTraceSummary(input) {
    const { cwd, pmemPath, changedFiles, userSummary, next, latestTask } = input;
    let isGit = false;
    try {
        (0, child_process_1.execSync)('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
        isGit = true;
    }
    catch { }
    const fileStats = new Map();
    if (isGit) {
        try {
            const numstatOutput = (0, child_process_1.execSync)("git diff --numstat HEAD -- . ':!.pmem'", { cwd, encoding: 'utf8', timeout: 5000 });
            const numstatLines = numstatOutput.split('\n');
            for (const line of numstatLines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    const add = parseInt(parts[0], 10);
                    const del = parseInt(parts[1], 10);
                    const filepath = parts[2];
                    if (!isNaN(add) && !isNaN(del)) {
                        fileStats.set(filepath, { additions: add, deletions: del });
                    }
                }
            }
        }
        catch { }
    }
    // Populate additions/deletions on changedFiles
    const updatedChangedFiles = changedFiles.map(cf => {
        const stats = fileStats.get(cf.path);
        return {
            ...cf,
            additions: stats ? stats.additions : undefined,
            deletions: stats ? stats.deletions : undefined
        };
    });
    // Extract symbol changes
    const whatChanged = [];
    const decisions = [];
    for (const cf of updatedChangedFiles) {
        const fullPath = path.join(cwd, cf.path);
        let currentContent = '';
        if ((0, fs_1.fileExists)(fullPath)) {
            try {
                currentContent = fs.readFileSync(fullPath, 'utf8');
            }
            catch { }
        }
        let headContent = '';
        if (isGit && cf.status !== 'A' && cf.status !== '??') {
            try {
                headContent = (0, child_process_1.execSync)(`git show HEAD:${cf.path}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
            }
            catch { }
        }
        // Symbol extraction
        const currentSymbols = (0, symbols_1.extractSymbols)(cf.path, currentContent);
        const headSymbols = (0, symbols_1.extractSymbols)(cf.path, headContent);
        const addedSymbols = currentSymbols.filter(s => !headSymbols.includes(s));
        const removedSymbols = headSymbols.filter(s => !currentSymbols.includes(s));
        const changeParts = [];
        if (cf.status === 'A' || cf.status === '??') {
            changeParts.push(`Created [${cf.path}](file://${path.resolve(cf.path)})`);
        }
        else if (cf.status === 'D') {
            changeParts.push(`Deleted [${cf.path}](file://${path.resolve(cf.path)})`);
        }
        else {
            changeParts.push(`Modified [${cf.path}](file://${path.resolve(cf.path)})`);
        }
        if (cf.additions !== undefined && cf.deletions !== undefined) {
            changeParts.push(`(+${cf.additions} -${cf.deletions} lines)`);
        }
        const symbolChanges = [];
        if (addedSymbols.length > 0) {
            symbolChanges.push(`added ${addedSymbols.slice(0, 5).join(', ')}${addedSymbols.length > 5 ? '...' : ''}`);
        }
        if (removedSymbols.length > 0) {
            symbolChanges.push(`removed ${removedSymbols.slice(0, 5).join(', ')}${removedSymbols.length > 5 ? '...' : ''}`);
        }
        if (symbolChanges.length > 0) {
            changeParts.push(`— ${symbolChanges.join('; ')}`);
        }
        whatChanged.push(changeParts.join(' '));
        // Decision comments scanning
        if (currentContent) {
            const lines = currentContent.split('\n');
            for (const line of lines) {
                const commentMatch = line.match(/(?:\/\/|#|\/\*)\s*(?:decision|decide|we decided|we choose|we use|决定|采用|固定|使用)\b:?\s*(.+)/i);
                if (commentMatch) {
                    decisions.push(commentMatch[1].trim());
                }
            }
        }
    }
    // Infer affected modules
    const affectedModulesSet = new Set();
    // 1. Try DB lookup first
    const dbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
            const allPaths = db.prepare("SELECT card_id, path FROM paths").all();
            for (const cf of changedFiles) {
                for (const p of allPaths) {
                    const isMatch = (() => {
                        const p1 = cf.path.replace(/\\/g, '/');
                        const p2 = p.path.replace(/\\/g, '/');
                        return p1 === p2 || p1.endsWith('/' + p2) || p2.endsWith('/' + p1);
                    })();
                    if (isMatch && p.card_id.startsWith('module.')) {
                        affectedModulesSet.add(p.card_id);
                    }
                }
            }
        }
        catch { }
    }
    // 2. Try MODULE_HINTS lookup
    for (const cf of changedFiles) {
        const lowerPath = cf.path.toLowerCase();
        for (const [moduleName, hints] of Object.entries(MODULE_HINTS)) {
            if (hints.some(hint => lowerPath.includes(hint.toLowerCase()))) {
                affectedModulesSet.add(`module.${moduleName}`);
            }
        }
    }
    const affectedModules = Array.from(affectedModulesSet);
    // Parse decisions from userSummary and latestTask
    const textToScan = [userSummary || '', latestTask || ''].join(' ');
    const sentences = textToScan.split(/[.!?。！？\n]/);
    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length > 5 && DECISION_KEYWORDS.some(kw => trimmed.includes(kw))) {
            decisions.push(trimmed);
        }
    }
    // Clean up decisions: limit length, unique
    const finalDecisions = Array.from(new Set(decisions.map(d => d.replace(/^-\s*/, '').trim()))).filter(d => d.length > 0);
    // Generate Title
    let title = '';
    if (userSummary) {
        title = userSummary.split('\n')[0].trim();
    }
    else if (latestTask) {
        title = latestTask;
    }
    else {
        const names = changedFiles.map(cf => path.basename(cf.path));
        title = `Update ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and others' : ''}`;
    }
    // Generate Summary
    let summaryText = userSummary || '';
    if (!summaryText) {
        if (latestTask) {
            summaryText = `Worked on task: ${latestTask}. `;
        }
        const changesDesc = changedFiles.map(cf => `${path.basename(cf.path)} (${cf.status})`).join(', ');
        summaryText += `Captured changes in ${changesDesc}.`;
    }
    // Why
    const why = [];
    if (latestTask) {
        why.push(`To complete the task: "${latestTask}".`);
    }
    if (finalDecisions.length > 0) {
        why.push(`Stabilize project choices: ${finalDecisions.join(', ')}.`);
    }
    if (why.length === 0) {
        why.push('Automated or manual context synchronization.');
    }
    // Next steps
    const nextSteps = [];
    if (next) {
        nextSteps.push(next);
    }
    else {
        if (affectedModules.length > 0) {
            nextSteps.push(`Continue development on ${affectedModules.join(', ')}.`);
        }
        else {
            nextSteps.push('Continue development.');
        }
    }
    // Architecture Notes
    const architectureNotes = [];
    if (affectedModules.length > 0) {
        architectureNotes.push(`Modifications impact the following modules: ${affectedModules.join(', ')}.`);
    }
    for (const cf of changedFiles) {
        if (cf.path.endsWith('.jsx') || cf.path.endsWith('.tsx') || cf.path.endsWith('.ts')) {
            architectureNotes.push(`Updated code symbols in [${path.basename(cf.path)}](file://${path.resolve(cf.path)}).`);
        }
    }
    return {
        title,
        summary: summaryText,
        whatChanged,
        why,
        architectureNotes,
        decisions: finalDecisions,
        affectedModules,
        changedFiles: updatedChangedFiles,
        next: nextSteps,
        confidence: userSummary ? 'high' : 'medium'
    };
}
//# sourceMappingURL=traceSummary.js.map