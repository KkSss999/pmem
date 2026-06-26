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
exports.readNext = readNext;
exports.writeManagedNext = writeManagedNext;
exports.migrateNextIfNeeded = migrateNextIfNeeded;
const path = __importStar(require("path"));
const fs_1 = require("./fs");
function readNext(pmemPath) {
    const nextPath = path.join(pmemPath, 'next.md');
    if (!(0, fs_1.fileExists)(nextPath)) {
        return { nextStep: 'No next step recorded.' };
    }
    const content = (0, fs_1.readFile)(nextPath) || '';
    const managedStart = '<!-- pmem:next:start -->';
    const managedEnd = '<!-- pmem:next:end -->';
    const startIdx = content.indexOf(managedStart);
    const endIdx = content.indexOf(managedEnd);
    if (startIdx >= 0 && endIdx > startIdx) {
        const block = content.substring(startIdx + managedStart.length, endIdx).trim();
        let nextStep = '';
        let why = '';
        const context = [];
        const lines = block.split('\n');
        let currentField = '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('## Recommended Next Step')) {
                currentField = 'next';
            }
            else if (trimmed.startsWith('## Why')) {
                currentField = 'why';
            }
            else if (trimmed.startsWith('## Needed Context')) {
                currentField = 'context';
            }
            else if (trimmed.startsWith('## ')) {
                currentField = '';
            }
            else if (currentField === 'next') {
                if (trimmed) {
                    nextStep = (nextStep + '\n' + trimmed).trim();
                }
            }
            else if (currentField === 'why') {
                if (trimmed) {
                    why = (why + '\n' + trimmed).trim();
                }
            }
            else if (currentField === 'context') {
                if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                    context.push(trimmed.substring(1).trim());
                }
                else if (trimmed) {
                    context.push(trimmed);
                }
            }
        }
        if (nextStep) {
            return { nextStep, why: why || undefined, context: context.length > 0 ? context : undefined };
        }
    }
    // Fallback to legacy extraction
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('## Recommended Next Step')) {
            const val = line.split('## Recommended Next Step')[1]?.trim();
            if (val)
                return { nextStep: val };
            if (i + 1 < lines.length && lines[i + 1].trim()) {
                return { nextStep: lines[i + 1].trim() };
            }
        }
    }
    return { nextStep: 'No next step recorded.' };
}
function writeManagedNext(pmemPath, nextState) {
    const nextPath = path.join(pmemPath, 'next.md');
    const managedStart = '<!-- pmem:next:start -->';
    const managedEnd = '<!-- pmem:next:end -->';
    const contextBlock = nextState.context && nextState.context.length > 0
        ? `\n\n## Needed Context\n${nextState.context.map(c => `- ${c}`).join('\n')}`
        : '';
    const whyBlock = nextState.why
        ? `\n\n## Why\n${nextState.why}`
        : '';
    const managedContent = `${managedStart}
## Recommended Next Step
${nextState.nextStep}${whyBlock}${contextBlock}
${managedEnd}`;
    let currentContent = '';
    if ((0, fs_1.fileExists)(nextPath)) {
        currentContent = (0, fs_1.readFile)(nextPath) || '';
    }
    else {
        currentContent = '# Next Steps\n\n';
    }
    const startIdx = currentContent.indexOf(managedStart);
    const endIdx = currentContent.indexOf(managedEnd);
    let updatedContent = '';
    if (startIdx >= 0 && endIdx > startIdx) {
        updatedContent = currentContent.substring(0, startIdx) +
            managedContent +
            currentContent.substring(endIdx + managedEnd.length);
    }
    else {
        const headingIndex = currentContent.indexOf('## Recommended Next Step');
        if (headingIndex >= 0) {
            updatedContent = currentContent.substring(0, headingIndex) + managedContent;
        }
        else {
            const spacer = currentContent.endsWith('\n') ? '' : '\n';
            updatedContent = `${currentContent}${spacer}\n${managedContent}\n`;
        }
    }
    // Write content, removing any duplicate outer headings if they somehow exist
    (0, fs_1.writeFile)(nextPath, updatedContent.trim() + '\n');
}
function migrateNextIfNeeded(pmemPath) {
    const nextPath = path.join(pmemPath, 'next.md');
    if (!(0, fs_1.fileExists)(nextPath))
        return;
    const content = (0, fs_1.readFile)(nextPath) || '';
    const managedStart = '<!-- pmem:next:start -->';
    if (content.indexOf(managedStart) < 0) {
        const state = readNext(pmemPath);
        writeManagedNext(pmemPath, state);
    }
}
//# sourceMappingURL=next.js.map