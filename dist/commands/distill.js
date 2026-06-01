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
exports.distillCommand = distillCommand;
const path = __importStar(require("path"));
const manifest_1 = require("../core/manifest");
const fs_1 = require("../core/fs");
const db_1 = require("../core/db");
const PMEM_DIR = '.pmem';
function distillCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        console.log('No .pmem/manifest.yml found. Run `pmem init` first.');
        return;
    }
    // Eagerly open DB if it exists, so downstream helpers can use getDatabase()
    const dbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            (0, db_1.openDatabase)(pmemPath);
        }
        catch {
            // DB exists but can't be opened — will fall back to file scanning
        }
    }
    if (options.applySuggestion) {
        applySuggestionAction(pmemPath, options.applySuggestion);
        return;
    }
    if (options.suggestSplits) {
        suggestCardSplits(pmemPath, manifest);
        return;
    }
    const traceFiles = (0, fs_1.listFiles)(path.join(pmemPath, 'traces'), /\.md$/);
    if (traceFiles.length === 0) {
        console.log('No trace files found to distill.');
        return;
    }
    // Parse all traces
    const traces = [];
    for (const file of traceFiles) {
        const card = parseCard(file);
        if (card && !isDistilled(card.frontmatter)) {
            traces.push(card);
        }
    }
    const undistilledCount = traces.length;
    if (undistilledCount === 0) {
        console.log('All traces are already distilled.');
        process.exit(0);
    }
    // Group by related node (DB-backed if available, frontmatter fallback otherwise)
    const groups = groupTracesByRelated(traces);
    console.log(`Found ${undistilledCount} undistilled trace(s) in ${groups.length} group(s).\n`);
    if (options.confirm) {
        applyDistillation(pmemPath, groups);
        // Mark traces as distilled
        markTracesDistilled(traceFiles, traces);
    }
    else {
        // Dry-run: show suggestions
        for (const group of groups) {
            console.log(`## Target: ${group.relatedNode}`);
            console.log(`  Traces: ${group.traces.length}`);
            console.log(`  Suggested update:`);
            console.log(`${group.suggestedUpdate.split('\n').map(l => '    ' + l).join('\n')}`);
            console.log('');
        }
        console.log('Run with --confirm to apply these changes.');
        // v0.6.2: Exit 0 when suggestions exist. Exit 1 no longer used as workflow signal.
    }
}
function applySuggestionAction(pmemPath, targetNodeId) {
    const traceFiles = (0, fs_1.listFiles)(path.join(pmemPath, 'traces'), /\.md$/);
    if (traceFiles.length === 0) {
        console.log('No trace files found to distill.');
        process.exit(2);
    }
    // Parse all traces
    const traces = [];
    for (const file of traceFiles) {
        const card = parseCard(file);
        if (card && !isDistilled(card.frontmatter)) {
            traces.push(card);
        }
    }
    if (traces.length === 0) {
        console.log('All traces are already distilled.');
        process.exit(0);
    }
    // Group by related node (reuse existing function)
    const groups = groupTracesByRelated(traces);
    // Find the group matching targetNodeId
    const matchingGroup = groups.find(g => g.relatedNode === targetNodeId);
    if (!matchingGroup) {
        console.log(`No undistilled traces found for target: ${targetNodeId}`);
        console.log('Available targets: ' + groups.map(g => g.relatedNode).join(', '));
        process.exit(2);
    }
    // Apply distillation for this group only
    applyDistillation(pmemPath, [matchingGroup]);
    markTracesDistilled(traceFiles, matchingGroup.traces);
    console.log(`Applied distillation to ${targetNodeId}: ${matchingGroup.traces.length} trace(s) merged.`);
    console.log('Run `pmem rebuild` to update indexes.');
    process.exit(0);
}
function parseCard(filePath) {
    const content = (0, fs_1.readFile)(filePath);
    if (!content)
        return null;
    return parseFrontmatterAndBody(content, filePath);
}
function parseFrontmatterAndBody(content, filePath) {
    if (!content.startsWith('---'))
        return null;
    const endIdx = content.indexOf('---', 4);
    if (endIdx < 0)
        return null;
    const fmText = content.substring(4, endIdx);
    const body = content.substring(endIdx + 3).trim();
    const frontmatter = { id: '', type: 'trace' };
    for (const line of fmText.split('\n')) {
        const match = line.match(/^(\w+):\s*(.+)/);
        if (match) {
            const key = match[1];
            let val = match[2].trim();
            if (key === 'tags' && val.startsWith('[')) {
                val = val.slice(1, -1).split(',').map((s) => s.trim());
            }
            if (key === 'related' && val.startsWith('[')) {
                val = val.slice(1, -1).split(',').map((s) => s.trim());
            }
            frontmatter[key] = val;
        }
    }
    return { frontmatter, body, filePath };
}
function isDistilled(fm) {
    return fm.distilled === true || fm.distilled === 'true';
}
// ---------------------------------------------------------------------------
// groupTracesByRelated — DB-backed grouping via edges table, with fallback
// ---------------------------------------------------------------------------
function groupTracesByRelated(traces) {
    const db = (0, db_1.getDatabase)();
    if (db) {
        try {
            return groupTracesByRelatedDb(traces, db);
        }
        catch {
            // DB query failed — fall back
        }
    }
    return groupTracesByRelatedFallback(traces);
}
function groupTracesByRelatedDb(traces, db) {
    const map = new Map();
    // For each trace, look up edges to find related module/decision/task/feature cards
    const relatedStmt = db.prepare(`
    SELECT e.to_id AS related_id FROM edges e
      JOIN cards c ON e.to_id = c.id
      WHERE e.from_id = ? AND c.type IN ('module', 'decision', 'task', 'feature') AND c.is_deleted = 0
    UNION
    SELECT e.from_id AS related_id FROM edges e
      JOIN cards c ON e.from_id = c.id
      WHERE e.to_id = ? AND c.type IN ('module', 'decision', 'task', 'feature') AND c.is_deleted = 0
  `);
    for (const trace of traces) {
        const traceId = trace.frontmatter.id;
        const edgeRows = relatedStmt.all(traceId, traceId);
        const key = edgeRows.length > 0 ? edgeRows[0].related_id : 'project';
        if (!map.has(key))
            map.set(key, []);
        map.get(key).push(trace);
    }
    return buildTraceGroups(map);
}
function groupTracesByRelatedFallback(traces) {
    const map = new Map();
    for (const trace of traces) {
        const related = trace.frontmatter.related || [];
        const key = related.length > 0 ? related[0] : 'project';
        if (!map.has(key))
            map.set(key, []);
        map.get(key).push(trace);
    }
    return buildTraceGroups(map);
}
function buildTraceGroups(map) {
    const groups = [];
    for (const [node, nodeTraces] of map) {
        const summaryParts = nodeTraces.map(t => {
            const title = extractMarkdownTitle(t.body) || path.basename(t.filePath, '.md');
            return `- ${title}`;
        });
        groups.push({
            relatedNode: node,
            traces: nodeTraces,
            suggestedUpdate: `Add distilled insights from ${nodeTraces.length} trace(s):\n${summaryParts.join('\n')}`,
        });
    }
    return groups;
}
function extractMarkdownTitle(body) {
    const match = body.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : null;
}
// ---------------------------------------------------------------------------
// findCardFile — DB-backed card lookup, with file-scanning fallback
// ---------------------------------------------------------------------------
function findCardFile(pmemPath, nodeId) {
    const db = (0, db_1.getDatabase)();
    if (db) {
        try {
            const row = db.prepare("SELECT file_path FROM cards WHERE id = ? AND is_deleted = 0").get(nodeId);
            if (row)
                return row.file_path;
        }
        catch {
            // DB query failed — fall back
        }
    }
    // Fall back to file scanning through modules/, features/, decisions/, tasks/
    for (const dir of ['modules', 'features', 'decisions', 'tasks']) {
        const dirPath = path.join(pmemPath, dir);
        if (!(0, fs_1.fileExists)(dirPath))
            continue;
        const files = (0, fs_1.listFiles)(dirPath, /\.md$/);
        for (const file of files) {
            const content = (0, fs_1.readFile)(file);
            if (content) {
                const fmMatch = content.match(/^id:\s*(.+)$/m);
                if (fmMatch && fmMatch[1].trim() === nodeId) {
                    return file;
                }
            }
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// applyDistillation / markTracesDistilled — unchanged core logic
// ---------------------------------------------------------------------------
function applyDistillation(pmemPath, groups) {
    for (const group of groups) {
        // Find the target card file
        const cardPath = findCardFile(pmemPath, group.relatedNode);
        if (!cardPath) {
            console.log(`  ⚠ Target card not found for ${group.relatedNode}, skipping.`);
            continue;
        }
        const content = (0, fs_1.readFile)(cardPath);
        if (!content)
            continue;
        // Append distilled content to the card
        const distilledSection = `\n\n## Distilled from Traces (${new Date().toISOString().split('T')[0]})\n${group.suggestedUpdate.split('\n').map(l => '> ' + l.replace(/^- /, '• ')).join('\n')}\n`;
        const updated = content.trimEnd() + distilledSection;
        (0, fs_1.atomicWrite)(cardPath, updated);
        console.log(`  ✓ Updated ${group.relatedNode} (${cardPath})`);
    }
}
function markTracesDistilled(allTraceFiles, allTraces) {
    let marked = 0;
    for (const file of allTraceFiles) {
        const content = (0, fs_1.readFile)(file);
        if (!content || !content.startsWith('---'))
            continue;
        // Check if this trace is in our undistilled set
        const isUndistilled = allTraces.some(t => t.filePath === file);
        if (!isUndistilled)
            continue;
        // Add distilled: true to frontmatter
        const endIdx = content.indexOf('---', 4);
        if (endIdx < 0)
            continue;
        const before = content.substring(0, endIdx);
        let fmText = content.substring(4, endIdx);
        const after = content.substring(endIdx);
        if (!fmText.includes('distilled:')) {
            fmText = fmText.trimEnd() + '\ndistilled: true';
            const updated = '---' + fmText + after;
            (0, fs_1.atomicWrite)(file, updated);
            marked++;
        }
    }
    if (marked > 0) {
        console.log(`  ✓ Marked ${marked} trace(s) as distilled.`);
        console.log('  Run `pmem rebuild` to update indexes.');
    }
}
// ---------------------------------------------------------------------------
// suggestCardSplits — DB-backed token counts, file-reading fallback
// ---------------------------------------------------------------------------
function suggestCardSplits(pmemPath, manifest) {
    if (!manifest?.card_policy) {
        console.log('No card_policy defined in manifest.');
        return;
    }
    const policy = manifest.card_policy;
    const suggestions = [];
    const db = (0, db_1.getDatabase)();
    if (db) {
        try {
            suggestCardSplitsDb(db, policy, suggestions);
        }
        catch {
            // DB query failed — fall back to file scanning
            suggestCardSplitsFallback(pmemPath, policy, suggestions);
        }
    }
    else {
        suggestCardSplitsFallback(pmemPath, policy, suggestions);
    }
    if (suggestions.length === 0) {
        console.log('No oversized cards detected.');
        return;
    }
    console.log('Card Split Suggestions:\n');
    for (const s of suggestions) {
        console.log(`## ${s.cardId}`);
        console.log(`  File: ${s.cardFile}`);
        console.log(`  Tokens: ~${s.currentTokens} / max ${s.maxTokens}`);
        console.log(`  Suggested splits:`);
        for (const split of s.suggestedSplits) {
            console.log(`    - ${s.cardId}.${toSlug(split)}`);
        }
        console.log('');
    }
    console.log('Review each card and split manually, or use a future `pmem split --interactive` command.');
}
function suggestCardSplitsDb(db, policy, suggestions) {
    const rows = db.prepare(`
    SELECT id, type, file_path, token_count FROM cards
    WHERE is_deleted = 0
      AND type != 'trace'
      AND file_path NOT LIKE '%/traces/%'
      AND file_path NOT LIKE '%/backups/%'
      AND file_path NOT LIKE '%/indexes/%'
      AND file_path NOT LIKE '%/integrations/%'
    ORDER BY token_count DESC
  `).all();
    for (const row of rows) {
        const maxForType = policy.max_tokens[row.type];
        const currentTokens = row.token_count > 0 ? row.token_count : 0;
        if (!maxForType || currentTokens <= maxForType)
            continue;
        // Still need to read the file for h2 section splitting suggestions
        const content = (0, fs_1.readFile)(row.file_path);
        const h2s = content ? content.match(/^##\s+(.+)$/gm) : null;
        const splitNames = h2s ? h2s.slice(0, 4).map(h => h.replace(/^##\s+/, '').trim()) : [];
        suggestions.push({
            cardId: row.id,
            cardFile: row.file_path,
            currentTokens,
            maxTokens: maxForType,
            suggestedSplits: splitNames.length > 0 ? splitNames : ['(No H2 sections to suggest splits from)'],
        });
    }
}
function suggestCardSplitsFallback(pmemPath, policy, suggestions) {
    // Scan all cards
    const cardFiles = (0, fs_1.listFiles)(pmemPath, /\.md$/);
    for (const file of cardFiles) {
        if (file.includes('/traces/') || file.includes('/backups/') || file.includes('/indexes/') || file.includes('/integrations/'))
            continue;
        const content = (0, fs_1.readFile)(file);
        if (!content)
            continue;
        const estimatedTokens = Math.ceil(content.length / 4);
        const card = parseCard(file);
        if (!card)
            continue;
        const maxForType = policy.max_tokens[card.frontmatter.type];
        if (maxForType && estimatedTokens > maxForType) {
            // Count markdown sections
            const h2s = content.match(/^##\s+(.+)$/gm);
            const splitNames = h2s ? h2s.slice(0, 4).map(h => h.replace(/^##\s+/, '').trim()) : [];
            suggestions.push({
                cardId: card.frontmatter.id || path.basename(file, '.md'),
                cardFile: file,
                currentTokens: estimatedTokens,
                maxTokens: maxForType,
                suggestedSplits: splitNames.length > 0 ? splitNames : ['(No H2 sections to suggest splits from)'],
            });
        }
    }
}
function toSlug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
//# sourceMappingURL=distill.js.map