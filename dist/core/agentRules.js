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
exports.writeAgentRules = writeAgentRules;
const path = __importStar(require("path"));
const fs_1 = require("./fs");
const RULES_CONTENT = `<!-- pmem:rules:start -->
# pmem Guidelines

Before editing files or starting a task, run:
\`pmem context "<task description>"\`

After completing a task or editing files, run:
\`pmem capture --auto\`

Rules:
- Do not manually edit .pmem core cards (e.g. decisions, modules) unless explicitly requested.
- Keep capture summaries short and factual.
- Prefer using \`pmem context\` over ad-hoc repo scanning.
<!-- pmem:rules:end -->`;
const CURSOR_MDC_CONTENT = `---
description: Use pmem project memory during coding tasks
alwaysApply: true
---

${RULES_CONTENT}`;
function writeAgentRules(cwd, options) {
    const installed = [];
    const targets = [
        { name: 'AGENTS.md', filePath: path.join(cwd, 'AGENTS.md') },
        { name: 'CLAUDE.md', filePath: path.join(cwd, 'CLAUDE.md') },
        { name: 'GEMINI.md', filePath: path.join(cwd, 'GEMINI.md') },
        { name: '.codex/instructions.md', filePath: path.join(cwd, '.codex', 'instructions.md') },
        { name: '.cursor/rules/pmem.mdc', filePath: path.join(cwd, '.cursor/rules/pmem.mdc'), isMdc: true },
        { name: '.clinerules/pmem.md', filePath: path.join(cwd, '.clinerules/pmem.md') },
        // Opt-ins
        { name: 'CONVENTIONS.md (Aider)', filePath: path.join(cwd, 'CONVENTIONS.md'), optIn: true },
        { name: '.windsurfrules', filePath: path.join(cwd, '.windsurfrules'), optIn: true }
    ];
    // Determine which files to write based on flags
    const selectedTargets = targets.filter(t => {
        // AGENTS.md is always written if we are running agentRules
        if (t.name === 'AGENTS.md')
            return true;
        // Aider and Windsurf are strictly opt-in and NEVER written via --all
        if (t.name === 'CONVENTIONS.md (Aider)')
            return !!options.aider;
        if (t.name === '.windsurfrules')
            return !!options.windsurf;
        // For all other targets, they are written if --all is passed or their specific flag is passed
        if (options.all)
            return true;
        if (t.name === 'CLAUDE.md')
            return !!options.claude;
        if (t.name === 'GEMINI.md')
            return !!options.gemini;
        if (t.name === '.codex/instructions.md')
            return !!options.codex;
        if (t.name === '.cursor/rules/pmem.mdc')
            return !!options.cursor;
        if (t.name === '.clinerules/pmem.md')
            return !!options.cline;
        return false;
    });
    for (const target of selectedTargets) {
        try {
            const dir = path.dirname(target.filePath);
            (0, fs_1.ensureDir)(dir);
            const contentToWrite = target.isMdc ? CURSOR_MDC_CONTENT : RULES_CONTENT;
            if ((0, fs_1.fileExists)(target.filePath)) {
                const existing = (0, fs_1.readFile)(target.filePath) || '';
                const startMarker = '<!-- pmem:rules:start -->';
                const endMarker = '<!-- pmem:rules:end -->';
                const startIndex = existing.indexOf(startMarker);
                const endIndex = existing.indexOf(endMarker);
                if (startIndex >= 0 && endIndex >= 0 && endIndex > startIndex) {
                    const updated = existing.substring(0, startIndex) +
                        contentToWrite +
                        existing.substring(endIndex + endMarker.length);
                    (0, fs_1.writeFile)(target.filePath, updated);
                }
                else {
                    // Append rules at the end
                    const spacer = existing.endsWith('\n') ? '' : '\n';
                    (0, fs_1.writeFile)(target.filePath, `${existing}${spacer}\n${contentToWrite}\n`);
                }
            }
            else {
                (0, fs_1.writeFile)(target.filePath, contentToWrite + '\n');
            }
            installed.push(target.name);
        }
        catch (err) {
            console.error(`Failed to write agent rules to ${target.name}: ${err.message}`);
        }
    }
    return installed;
}
//# sourceMappingURL=agentRules.js.map