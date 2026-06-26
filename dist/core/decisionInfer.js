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
exports.inferDecisions = inferDecisions;
exports.writeInferredDecisions = writeInferredDecisions;
exports.writeDecisionCandidates = writeDecisionCandidates;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const traceParse_1 = require("./traceParse");
const fs_1 = require("./fs");
function inferDecisions(pmemPath) {
    const traceDir = path.join(pmemPath, 'traces');
    if (!(0, fs_1.fileExists)(traceDir))
        return [];
    const decisions = [];
    try {
        const traceFiles = fs.readdirSync(traceDir)
            .filter(f => f.endsWith('.md'))
            .sort((a, b) => a.localeCompare(b)); // Chronological order
        for (const file of traceFiles) {
            const filePath = path.join(traceDir, file);
            const content = (0, fs_1.readFile)(filePath);
            if (!content)
                continue;
            const parsed = (0, traceParse_1.parseTraceCard)(content);
            if (!parsed || !parsed.decisions || parsed.decisions.length === 0)
                continue;
            for (const dec of parsed.decisions) {
                if (dec === '(none)')
                    continue;
                // Generate slug from decision statement
                const slug = dec
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_|_$/g, '')
                    .slice(0, 40);
                const id = `decision.${slug}`;
                // Look for existing
                let existing = decisions.find(d => d.id === id);
                if (existing) {
                    if (!existing.evidence.includes(parsed.id)) {
                        existing.evidence.push(parsed.id);
                    }
                }
                else {
                    // Uniquify title from decision statement
                    let title = dec.charAt(0).toUpperCase() + dec.slice(1);
                    if (title.length > 50) {
                        title = title.slice(0, 47) + '...';
                    }
                    decisions.push({
                        id,
                        title,
                        statement: dec,
                        reason: `Inferred from trace ${parsed.id}`,
                        evidence: [parsed.id],
                        related: parsed.changedFiles
                            .filter(f => f.includes('App') || f.includes('engine') || f.includes('render'))
                            .map(f => {
                            if (f.toLowerCase().includes('engine'))
                                return 'module.engine';
                            if (f.toLowerCase().includes('render'))
                                return 'module.renderer';
                            return 'module.ui';
                        }),
                        source_files: parsed.changedFiles
                    });
                }
            }
        }
    }
    catch { }
    // Deduplicate related modules
    for (const d of decisions) {
        d.related = Array.from(new Set(d.related));
    }
    return decisions;
}
function writeInferredDecisions(pmemPath, decisions) {
    const writtenPaths = [];
    const decisionsDir = path.join(pmemPath, 'decisions');
    (0, fs_1.ensureDir)(decisionsDir);
    for (const d of decisions) {
        const filename = `${d.id}.md`;
        const filePath = path.join(decisionsDir, filename);
        const content = `---
id: ${d.id}
type: decision
status: active
tags:
  - inferred
updated: "${new Date().toISOString()}"
related:
${d.related.map(r => `  - ${r}`).join('\n')}
source_files:
${d.source_files.map(sf => `  - ${sf}`).join('\n')}
---

# ${d.title}

## Decision
${d.statement}

## Reason
${d.reason}

## Impact
- Renderer and logic bounds depend on this decision.
- Project implementations must align with this choice.

## Evidence
${d.evidence.map(e => `- [[${e}]]`).join('\n')}
`;
        (0, fs_1.atomicWrite)(filePath, content);
        writtenPaths.push(filePath);
    }
    return writtenPaths;
}
function writeDecisionCandidates(pmemPath, decisions) {
    const candidatesDir = path.join(pmemPath, 'candidates');
    (0, fs_1.ensureDir)(candidatesDir);
    const filePath = path.join(candidatesDir, 'decisions.generated.md');
    const content = `# Generated Decision Candidates

Generated on ${new Date().toISOString().split('T')[0]}.

## Candidates
${decisions.map(d => `### ${d.title}
- Suggested ID: ${d.id}
- Statement: ${d.statement}
- Evidence: ${d.evidence.join(', ')}
- Related: ${d.related.join(', ')}
`).join('\n')}

Run \`pmem decision infer --write\` to finalize these decision cards.
`;
    (0, fs_1.atomicWrite)(filePath, content);
    return filePath;
}
//# sourceMappingURL=decisionInfer.js.map