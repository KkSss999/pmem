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
exports.updateCommand = updateCommand;
exports.markDirtyCommand = markDirtyCommand;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const rebuild_1 = require("./rebuild");
const db_1 = require("../core/db");
const git_1 = require("../core/git");
const consistency_1 = require("../core/consistency");
const PMEM_DIR = '.pmem';
function updateCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        console.log('No manifest found. Run `pmem init` first.');
        return;
    }
    // --accept-edges / --reject-edges: manage inferred edges
    if (options.acceptEdges || options.rejectEdges) {
        manageEdges(pmemPath, options.acceptEdges, options.rejectEdges);
        return;
    }
    // --suggest: show intelligent update suggestions
    if (options.suggest) {
        suggestActions(pmemPath, options.format, options.includeHistory);
        return;
    }
    // --apply-suggestion: apply a specific suggestion
    if (options.applySuggestion) {
        applySuggestionAction(pmemPath, options.applySuggestion);
        return;
    }
    // --auto: detect changes, suggest actions
    if (options.auto) {
        autoUpdate(pmemPath, manifest);
        return;
    }
    // --confirm or --force: write changes
    if (options.confirm || options.force) {
        confirmUpdate(pmemPath, options.summary, options.next, options.refreshVerified);
        return;
    }
    // no flag: show current dirty state
    showDirtyState(pmemPath);
}
function markDirtyCommand(reason, options = {}) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    // --card <id>: explicitly mark specific cards as dirty
    if (options.cardIds && options.cardIds.length > 0) {
        const dbPath = path.join(pmemPath, 'pmem.db');
        if (!(0, fs_1.fileExists)(dbPath)) {
            console.log('No SQLite database found. Run `pmem rebuild` first.');
            process.exit(2);
        }
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            const activeSession = (0, db_1.getActiveSession)(db);
            for (const cardId of options.cardIds) {
                const card = db.prepare('SELECT id FROM cards WHERE id = ? AND is_deleted = 0').get(cardId);
                if (card) {
                    (0, db_1.insertDirtyFlag)(db, 'card', cardId, reason, activeSession?.id);
                    console.log(`Marked card dirty: ${cardId}`);
                }
                else {
                    console.log(`Card not found or deleted: ${cardId}`);
                }
            }
            // Also mark project-level dirty
            const manifest = (0, manifest_1.loadManifest)(pmemPath);
            if (manifest) {
                const timestamp = new Date().toISOString();
                manifest.memory_status.dirty = true;
                manifest.memory_status.dirty_reason = reason;
                manifest.memory_status.dirty_since = timestamp;
                (0, manifest_1.saveManifest)(pmemPath, manifest);
                (0, db_1.insertDirtyFlag)(db, 'project', '.pmem', reason, activeSession?.id);
            }
            (0, db_1.closeDatabase)();
            return;
        }
        catch (err) {
            console.error('Could not mark cards as dirty:', err);
            process.exit(2);
        }
    }
    // --auto: detect changed files via git and mark related cards as dirty
    if (options.auto) {
        const dbPath = path.join(pmemPath, 'pmem.db');
        if ((0, fs_1.fileExists)(dbPath)) {
            // Check git availability before attempting git commands
            const useGit = (() => {
                try {
                    (0, child_process_1.execSync)('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
                    return true;
                }
                catch {
                    return false;
                }
            })();
            if (!useGit) {
                console.log('Cannot auto-detect changes: this directory is not inside a Git repository.');
                console.log('Next: run `pmem status` (uses mtime fallback) or initialize git with `git init`.');
                process.exit(2);
            }
            try {
                const db = (0, db_1.openDatabase)(pmemPath);
                const output = (0, child_process_1.execSync)('git status --porcelain', { encoding: 'utf8', cwd });
                const changedFiles = (0, git_1.parseGitStatusPorcelain)(output).map(change => change.path);
                const activeSession = (0, db_1.getActiveSession)(db);
                const dirtyCards = [];
                const allPaths = db.prepare("SELECT card_id, path FROM paths").all();
                for (const filePath of changedFiles) {
                    for (const p of allPaths) {
                        if ((0, fs_1.isPathMatch)(filePath, p.path)) {
                            if (!dirtyCards.includes(p.card_id)) {
                                (0, db_1.insertDirtyFlag)(db, 'card', p.card_id, 'file_changed: ' + filePath, activeSession?.id);
                                dirtyCards.push(p.card_id);
                            }
                        }
                    }
                }
                (0, db_1.closeDatabase)();
                if (dirtyCards.length > 0) {
                    console.log(`Auto-marked ${dirtyCards.length} card(s) as dirty.`);
                    return;
                }
                else {
                    console.log('No related cards found for changed files.');
                    process.exit(1);
                }
            }
            catch (err) {
                console.error('Could not auto-detect changed files.');
                console.error('Run `pmem status` to check change detection, or `pmem update --confirm` to manually record changes.');
                process.exit(2);
            }
        }
        // DB doesn't exist: fall through to existing global dirty behavior
    }
    const dirtyFile = path.join(pmemPath, '.dirty');
    const timestamp = new Date().toISOString();
    (0, fs_1.atomicWrite)(dirtyFile, `reason: ${reason}\nsince: ${timestamp}\n`);
    // Update manifest dirty state
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (manifest) {
        // Update manifest.memory_status for dirty tracking
        manifest.memory_status.dirty = true;
        manifest.memory_status.dirty_reason = reason;
        manifest.memory_status.dirty_since = timestamp;
        (0, manifest_1.saveManifest)(pmemPath, manifest);
        console.log(`Memory marked as dirty.`);
        console.log(`  Reason: ${reason}`);
        console.log(`  Since: ${timestamp}`);
        console.log(`\nRun \`pmem update --auto\` to detect changes or \`pmem update --confirm\` to record them.`);
    }
    // SQLite: log dirty flag (additive — does not replace file-based dirty tracking)
    const dbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            const activeSession = (0, db_1.getActiveSession)(db);
            (0, db_1.insertDirtyFlag)(db, 'project', '.pmem', reason, activeSession?.id);
            (0, db_1.closeDatabase)();
            console.log(`  Dirty flag logged to SQLite.`);
        }
        catch {
            // DB not available or schema not yet created — skip SQLite
        }
    }
}
function showDirtyState(pmemPath) {
    const dirtyFile = path.join(pmemPath, '.dirty');
    if ((0, fs_1.fileExists)(dirtyFile)) {
        const content = (0, fs_1.readFile)(dirtyFile);
        console.log('Memory is marked as dirty:');
        console.log(content);
        console.log('Run `pmem update --auto` to detect changes.');
    }
    else {
        console.log('Memory is clean.');
    }
}
function autoUpdate(pmemPath, manifest) {
    console.log('Auto-detecting changes...\n');
    // Check if dirty
    const dirtyFile = path.join(pmemPath, '.dirty');
    const isDirty = (0, fs_1.fileExists)(dirtyFile);
    if (isDirty) {
        const content = (0, fs_1.readFile)(dirtyFile);
        console.log('Dirty memory detected:');
        console.log(content);
    }
    // Check state.md freshness
    const statePath = path.join(pmemPath, 'state.md');
    if ((0, fs_1.fileExists)(statePath)) {
        const stateStat = require('fs').statSync(statePath);
        const hoursSinceUpdate = (Date.now() - stateStat.mtimeMs) / (1000 * 60 * 60);
        if (hoursSinceUpdate > 24) {
            console.log(`- state.md was last updated ${hoursSinceUpdate.toFixed(1)} hours ago.`);
        }
    }
    // Check if next.md is empty
    const nextPath = path.join(pmemPath, 'next.md');
    if ((0, fs_1.fileExists)(nextPath)) {
        const nextContent = (0, fs_1.readFile)(nextPath) || '';
        if (nextContent.replace(/#.*\n/g, '').trim().length < 50) {
            console.log('- next.md appears to have minimal content.');
        }
    }
    // Suggest: check for new files in project that aren't in memory
    const sourceFiles = listSourceFiles(process.cwd());
    console.log(`\nProject source files: ${sourceFiles.length}`);
    console.log('\nSuggested actions:');
    if (isDirty) {
        console.log('  1. Review changes and update memory cards.');
        console.log('  2. Create decision cards if architecture changed.');
        console.log('  3. Run `pmem update --confirm --summary "<what changed>" --next "<next step>"`');
    }
    else {
        console.log('  Memory appears up to date. No action needed.');
    }
    // SQLite: show unresolved dirty flags and recent update activity
    const updateDbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(updateDbPath)) {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            const unresolved = (0, db_1.getUnresolvedDirtyFlags)(db);
            if (unresolved.length > 0) {
                console.log(`\nUnresolved dirty flags in SQLite: ${unresolved.length}`);
            }
            const recentLogs = (0, db_1.getRecentUpdateLogs)(db, 5);
            if (recentLogs.length > 0) {
                console.log('\nRecent update activity:');
                for (const log of recentLogs) {
                    const icon = log.success ? '✓' : '✗';
                    console.log(`  ${icon} [${log.created_at.slice(0, 16)}] ${log.action}${log.summary ? ': ' + log.summary.slice(0, 60) : ''}`);
                }
            }
            (0, db_1.closeDatabase)();
        }
        catch {
            // DB not available — skip SQLite
        }
    }
}
function confirmUpdate(pmemPath, summary, next, refreshVerified) {
    const lockPath = path.join(pmemPath, '.lock');
    if (!(0, fs_1.acquireLock)(lockPath)) {
        console.log('Failed to acquire pmem lock after 3s.');
        console.log('  The lock at .pmem/.lock may be held by another pmem process, or a stale lock from a previous crash.');
        console.log('  → Run: pmem verify --fix-locks  (to check and clean stale locks)');
        console.log('  → Or:  pmem doctor              (to diagnose lock status)');
        console.log('  If no other pmem process is running, delete .pmem/.lock manually.');
        console.log('No memory was written. Try again after resolving the lock.');
        return;
    }
    try {
        // Update next.md
        if (next) {
            const nextPath = path.join(pmemPath, 'next.md');
            (0, fs_1.atomicWrite)(nextPath, `# Next Steps

## Recommended Next Step
${next}

## Why
Confirmed during update.

## Needed Context
Run \`pmem recall\` for full context.
`);
        }
        let sqliteLogged = false;
        // Add trace if summary provided
        if (summary) {
            const today = new Date().toISOString().split('T')[0];
            const traceDir = path.join(pmemPath, 'traces');
            (0, fs_1.ensureDir)(traceDir);
            // Find the next trace number
            const fs = require('fs');
            const existingTraces = fs.readdirSync(traceDir)
                .filter((f) => f.startsWith(today))
                .length;
            const traceNum = String(existingTraces + 1).padStart(3, '0');
            const traceFile = path.join(traceDir, `${today}-${traceNum}.md`);
            (0, fs_1.atomicWrite)(traceFile, `---
id: trace.${today}-${traceNum}
type: trace
created: ${today}
---

# Trace: ${summary}

## What Changed
${summary}

## Next
${next || 'Continue as planned.'}
`);
            console.log(`Trace written: traces/${today}-${traceNum}.md`);
            // SQLite: resolve dirty flags and log the update (additive)
            const confirmDbPath = path.join(pmemPath, 'pmem.db');
            if ((0, fs_1.fileExists)(confirmDbPath)) {
                try {
                    const db = (0, db_1.openDatabase)(pmemPath);
                    const activeSession = (0, db_1.getActiveSession)(db);
                    (0, db_1.resolveDirtyFlags)(db, 'project', '.pmem');
                    (0, db_1.insertUpdateLog)(db, 'confirm_update', summary, activeSession?.id, [`trace.${today}-${traceNum}`], true);
                    (0, db_1.closeDatabase)();
                    sqliteLogged = true;
                }
                catch {
                    // DB not available — skip SQLite
                }
            }
        }
        // Clear dirty flag
        const dirtyFile = path.join(pmemPath, '.dirty');
        if ((0, fs_1.fileExists)(dirtyFile)) {
            require('fs').unlinkSync(dirtyFile);
        }
        // Clear manifest dirty state
        const manifest = (0, manifest_1.loadManifest)(pmemPath);
        if (manifest) {
            manifest.memory_status.dirty = false;
            manifest.memory_status.dirty_reason = null;
            manifest.memory_status.dirty_since = null;
            (0, manifest_1.saveManifest)(pmemPath, manifest);
        }
        // --refresh-verified: bump last_verified on specified cards.
        // MUST run BEFORE rebuildCommand() so the updated frontmatter
        // is picked up by the rebuild and SQLite hashes stay in sync.
        if (refreshVerified) {
            const cardIds = refreshVerified.split(',').map(s => s.trim()).filter(Boolean);
            const refreshDbPath = path.join(pmemPath, 'pmem.db');
            if ((0, fs_1.fileExists)(refreshDbPath) && cardIds.length > 0) {
                try {
                    const refreshDb = (0, db_1.openDatabase)(pmemPath); // open once
                    const refreshed = [];
                    for (const cardId of cardIds) {
                        const card = refreshDb.prepare('SELECT file_path FROM cards WHERE id = ?').get(cardId);
                        if (card) {
                            const cardFilePath = path.join(process.cwd(), card.file_path);
                            if ((0, fs_1.fileExists)(cardFilePath)) {
                                const content = (0, fs_1.readFile)(cardFilePath);
                                if (content) {
                                    const match = content.match(/^---\n([\s\S]*?)\n---/);
                                    if (match) {
                                        const frontmatterText = match[1];
                                        const nowStr = new Date().toISOString();
                                        let newFmText = frontmatterText;
                                        const regex = /^last_verified:.*$/m;
                                        if (regex.test(frontmatterText)) {
                                            newFmText = frontmatterText.replace(regex, `last_verified: "${nowStr}"`);
                                        }
                                        else {
                                            newFmText = frontmatterText.trimEnd() + `\nlast_verified: "${nowStr}"`;
                                        }
                                        const newContent = content.replace(/^---\n([\s\S]*?)\n---/, `---\n${newFmText}\n---`);
                                        (0, fs_1.writeFile)(cardFilePath, newContent);
                                        refreshed.push(cardId);
                                    }
                                }
                            }
                        }
                    }
                    if (refreshed.length > 0) {
                        console.log(`Refreshed last_verified for: ${refreshed.join(', ')}`);
                    }
                }
                catch {
                    // skip cards that can't be refreshed
                }
            }
        }
        // Rebuild indexes — picks up frontmatter changes from --refresh-verified above
        console.log('Rebuilding indexes...');
        (0, rebuild_1.rebuildCommand)();
        console.log('\n✓ Memory updated.');
        if (sqliteLogged) {
            console.log('  Update logged to SQLite.');
        }
    }
    finally {
        (0, fs_1.releaseLock)(lockPath);
    }
}
function listSourceFiles(root) {
    const fs = require('fs');
    const results = [];
    const skipDirs = new Set(['node_modules', '.git', '.pmem', 'dist', 'build', '.claude']);
    function walk(dir) {
        if (!(0, fs_1.fileExists)(dir))
            return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (skipDirs.has(entry.name))
                continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            }
            else if (/\.(ts|js|tsx|jsx|py|rs|go|java|rb|php)$/.test(entry.name)) {
                results.push(fullPath);
            }
        }
    }
    walk(root);
    return results;
}
/**
 * Extract the matched file path from a dirty flag reason string.
 * Handles formats like "file_changed: path/to/file" or plain text.
 */
function extractMatchedFile(reason) {
    const match = reason.match(/^file_changed:\s*(.+)/);
    if (match) {
        return match[1].trim();
    }
    return null;
}
/**
 * Build the aggregation key for a dirty flag: target + reason + matched_file.
 */
function aggregationKey(flag) {
    const mf = extractMatchedFile(flag.reason);
    return `${flag.target}||${flag.reason}||${mf ?? ''}`;
}
/**
 * Find the most recent session end time.
 * Returns null if no ended session exists.
 */
function getLatestSessionEnd(pmemPath) {
    try {
        const db = (0, db_1.openDatabase)(pmemPath);
        const row = db.prepare("SELECT ended_at FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1").get();
        return row?.ended_at ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Get the active (un-ended) session if one exists.
 */
function getActiveSessionStart(pmemPath) {
    try {
        const db = (0, db_1.openDatabase)(pmemPath);
        const row = db.prepare("SELECT started_at FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get();
        return row?.started_at ?? null;
    }
    catch {
        return null;
    }
}
function generateSuggestions(pmemPath, includeHistory = false) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        return {
            summary: { affected_cards: 0, blocking: 0, warning: 0, info: 0, duplicates_hidden: 0, historical_hidden: 0, verify_blocking: false },
            message: 'No SQLite database. Run pmem rebuild first.',
            next_steps: ['Run `pmem rebuild` to create the database index.'],
            groups: { blocking_for_verify: [], current_suggestions: [], historical_dirty_flags: [] },
            error: true,
        };
    }
    let db;
    try {
        db = (0, db_1.openDatabase)(pmemPath);
    }
    catch {
        return {
            summary: { affected_cards: 0, blocking: 0, warning: 0, info: 0, duplicates_hidden: 0, historical_hidden: 0, verify_blocking: false },
            message: 'Cannot open database. Run pmem rebuild first.',
            next_steps: ['Run `pmem rebuild` to recreate the database.'],
            groups: { blocking_for_verify: [], current_suggestions: [], historical_dirty_flags: [] },
            error: true,
        };
    }
    // 1. Get raw dirty flags with full details
    const allFlags = (0, db_1.getUnresolvedDirtyFlagsDetailed)(db);
    // 2. Run shared stale-memory consistency check
    const staleIssues = (0, consistency_1.checkStaleMemory)(pmemPath);
    // Build lookup: card_id → set of stale file paths
    const staleByCard = new Map();
    for (const issue of staleIssues) {
        if (issue.card_id) {
            if (!staleByCard.has(issue.card_id)) {
                staleByCard.set(issue.card_id, new Set());
            }
            if (issue.file_path) {
                staleByCard.get(issue.card_id).add(issue.file_path);
            }
        }
    }
    // 3. Aggregate dirty flags by target + reason + matched_file
    const groups = new Map();
    for (const flag of allFlags) {
        const key = aggregationKey(flag);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(flag);
    }
    // 4. Get session boundaries for historical classification
    const latestSessionEnd = getLatestSessionEnd(pmemPath);
    const activeSessionStart = getActiveSessionStart(pmemPath);
    const sessionBoundary = latestSessionEnd || activeSessionStart;
    // 5. Get total card count for affected_cards
    const cardCount = getCardCount(pmemPath);
    // 6. Classify each aggregated group
    const blockingForVerify = [];
    const currentSuggestions = [];
    const historicalDirtyFlags = [];
    for (const [key, flags] of groups) {
        const representative = flags[0];
        const matchedFile = extractMatchedFile(representative.reason);
        // Determine if this group blocks verify
        let blocksVerify = false;
        if (representative.scope === 'card' && staleByCard.has(representative.target)) {
            const staleFiles = staleByCard.get(representative.target);
            if (matchedFile && staleFiles.has(matchedFile)) {
                blocksVerify = true;
            }
            else if (!matchedFile) {
                // Card is in stale list, even if we can't match the specific file
                blocksVerify = true;
            }
        }
        // Determine severity
        let severity;
        if (blocksVerify) {
            severity = 'blocking';
        }
        else if (representative.scope === 'card') {
            severity = 'warning';
        }
        else {
            severity = 'info';
        }
        // Historical classification
        const allCreatedAts = flags.map(f => f.created_at).sort();
        const latestCreated = allCreatedAts[allCreatedAts.length - 1];
        const earliestCreated = allCreatedAts[0];
        const isMulti = flags.length > 1;
        let isHistorical = false;
        let isDuplicate = false;
        if (blocksVerify) {
            // Blocking items are never historical
            isHistorical = false;
            isDuplicate = isMulti;
        }
        else if (sessionBoundary && latestCreated < sessionBoundary) {
            // All flags are from before the session boundary → historical
            isHistorical = true;
            isDuplicate = isMulti;
        }
        else if (isMulti && sessionBoundary && latestCreated < sessionBoundary) {
            // Multiple flags, all old → historical duplicate
            isHistorical = true;
            isDuplicate = true;
        }
        else {
            // Default: keep in current
            isHistorical = false;
            isDuplicate = isMulti;
        }
        const aggregated = {
            target: representative.target,
            reason: representative.reason,
            matched_file: matchedFile,
            count: flags.length,
            severity,
            blocks_verify: blocksVerify,
            is_duplicate: isDuplicate,
            is_historical: isHistorical,
            created_at_first: earliestCreated,
            created_at_last: latestCreated,
            sources: flags.map(f => ({
                scope: f.scope,
                target: f.target,
                reason: f.reason,
                created_at: f.created_at,
                session_id: f.session_id,
            })),
        };
        if (blocksVerify) {
            blockingForVerify.push(aggregated);
        }
        else if (isHistorical) {
            historicalDirtyFlags.push(aggregated);
        }
        else {
            currentSuggestions.push(aggregated);
        }
    }
    // 7. Compute summary
    const uniqueAffectedCards = new Set();
    for (const item of [...blockingForVerify, ...currentSuggestions]) {
        uniqueAffectedCards.add(item.target);
    }
    const duplicatesHidden = [...blockingForVerify, ...currentSuggestions, ...historicalDirtyFlags]
        .filter(g => g.count > 1)
        .reduce((sum, g) => sum + (g.count - 1), 0);
    const summary = {
        affected_cards: uniqueAffectedCards.size,
        blocking: blockingForVerify.length,
        warning: currentSuggestions.filter(g => g.severity === 'warning').length,
        info: currentSuggestions.filter(g => g.severity === 'info').length,
        duplicates_hidden: duplicatesHidden,
        historical_hidden: includeHistory ? 0 : historicalDirtyFlags.length,
        verify_blocking: blockingForVerify.length > 0,
    };
    // 8. Build message and next steps
    const message = buildSuggestMessage(summary, cardCount);
    const nextSteps = buildSuggestNextSteps(summary, cardCount);
    return {
        summary,
        message,
        next_steps: nextSteps,
        groups: {
            blocking_for_verify: blockingForVerify,
            current_suggestions: currentSuggestions,
            historical_dirty_flags: includeHistory ? historicalDirtyFlags : [],
        },
    };
}
function suggestActions(pmemPath, format, includeHistory) {
    let report = generateSuggestions(pmemPath, includeHistory);
    report = enrichWithEdgeSuggestions(pmemPath, report);
    if (format === 'json') {
        console.log(JSON.stringify({
            summary: report.summary,
            message: report.message,
            next_steps: report.next_steps,
            groups: report.groups,
        }, null, 2));
    }
    else {
        // Compact output
        console.log('Memory update suggestions');
        console.log('');
        console.log(`Affected cards: ${report.summary.affected_cards}`);
        console.log(`Blocking for verify: ${report.summary.blocking}`);
        console.log(`Current suggestions: ${report.summary.warning + report.summary.info}`);
        console.log(`Historical hidden: ${report.summary.historical_hidden}`);
        console.log(`Duplicate flags hidden: ${report.summary.duplicates_hidden}`);
        // Blocking section
        if (report.groups.blocking_for_verify.length > 0) {
            console.log('');
            console.log('Blocking:');
            for (const item of report.groups.blocking_for_verify) {
                const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
                const countPart = item.count > 1 ? `, count ${item.count}` : '';
                console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
            }
        }
        // Current section
        if (report.groups.current_suggestions.length > 0) {
            console.log('');
            console.log('Current:');
            for (const item of report.groups.current_suggestions) {
                const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
                const countPart = item.count > 1 ? `, count ${item.count}` : '';
                console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
            }
        }
        // Historical section (only when --include-history)
        if (includeHistory && report.groups.historical_dirty_flags.length > 0) {
            console.log('');
            console.log('Historical:');
            for (const item of report.groups.historical_dirty_flags) {
                const filePart = (item.matched_file && !item.reason.includes(item.matched_file)) ? `, ${item.matched_file}` : '';
                const countPart = item.count > 1 ? `, count ${item.count}` : '';
                console.log(`  - ${item.target} (${item.reason}${filePart}${countPart})`);
            }
        }
        // Message
        console.log('');
        if (report.summary.blocking > 0) {
            console.log(report.message);
        }
        else {
            console.log('No blocking memory consistency issues.');
            if (report.summary.historical_hidden > 0) {
                console.log('Historical suggestions available with --include-history.');
            }
        }
        // Next steps
        if (report.next_steps.length > 0) {
            console.log('');
            console.log('Next:');
            for (const step of report.next_steps) {
                console.log(`  - ${step}`);
            }
        }
    }
    // Exit code: 2 for runtime errors (missing DB, etc.)
    if (report.error) {
        process.exit(2);
    }
    // v0.6.2: Exit 0 regardless of whether suggestions were found.
    // Exit 1 is no longer used as "actionable suggestions exist" workflow signal.
    // Agents should check JSON output summary fields instead of exit code.
}
function getCardCount(pmemPath) {
    try {
        const db = (0, db_1.openDatabase)(pmemPath);
        const row = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0 AND is_candidate = 0').get();
        return row?.count ?? 0;
    }
    catch {
        return 0;
    }
}
function buildSuggestMessage(summary, cardCount) {
    if (cardCount === 0) {
        return 'No memory cards found. Create a first module, decision, or task card to start building project memory.';
    }
    if (summary.blocking > 0 || summary.warning > 0 || summary.info > 0) {
        const parts = [];
        if (summary.blocking > 0)
            parts.push(`${summary.blocking} blocking memory consistency issue(s)`);
        if (summary.warning > 0)
            parts.push(`${summary.warning} current suggestion(s)`);
        if (summary.info > 0)
            parts.push(`${summary.info} informational item(s)`);
        return parts.join(' and ') + '.';
    }
    return 'No suggestions. Memory is up to date.';
}
function buildSuggestNextSteps(summary, cardCount) {
    const steps = [];
    if (cardCount === 0) {
        steps.push('Create a module card with source_files pointing to your code');
        steps.push('Run `pmem rebuild` after creating cards');
        steps.push('Then try `pmem status` and `pmem mark-dirty --auto`');
    }
    else if (summary.blocking > 0 || summary.warning > 0) {
        steps.push('Update or confirm affected cards with pmem update --confirm -s "<summary>" -n "<next step>"');
        steps.push('Use --include-history to inspect older dirty flags.');
    }
    else if (summary.historical_hidden > 0) {
        steps.push('Use --include-history to inspect older dirty flags.');
        steps.push('Run `pmem verify` to check overall memory consistency.');
    }
    else {
        steps.push('Edit some source files, then run `pmem status` and `pmem mark-dirty --auto`');
        steps.push('Run `pmem verify` to check overall memory consistency');
    }
    return steps;
}
function applySuggestionAction(pmemPath, suggestionId) {
    // Re-derive suggestions to find the matching one (with history included for full search)
    const report = generateSuggestions(pmemPath, true);
    // Flatten all groups into a single searchable list with generated IDs
    const flatList = [];
    let idx = 1;
    for (const item of report.groups.blocking_for_verify) {
        const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
        flatList.push({ id: `suggest-${idx}`, item, action });
        idx++;
    }
    for (const item of report.groups.current_suggestions) {
        const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
        flatList.push({ id: `suggest-${idx}`, item, action });
        idx++;
    }
    for (const item of report.groups.historical_dirty_flags) {
        const action = item.reason.startsWith('file_changed') ? 'update_card' : 'create_trace';
        flatList.push({ id: `suggest-${idx}`, item, action });
        idx++;
    }
    const match = flatList.find(s => s.id === suggestionId);
    if (!match) {
        console.log(`Suggestion "${suggestionId}" not found. Available suggestions:`);
        for (const s of flatList) {
            const filePart = s.item.matched_file ? `, ${s.item.matched_file}` : '';
            console.log(`  ${s.id}: ${s.action} ${s.item.target} (${s.item.reason}${filePart})`);
        }
        process.exit(2);
    }
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        console.log('No SQLite database. Run pmem rebuild first.');
        process.exit(2);
    }
    const action = match.action;
    const target = match.item.target;
    const reason = match.item.reason;
    switch (action) {
        case 'update_card': {
            const db = (0, db_1.openDatabase)(pmemPath);
            // Mark the card's last_verified_at as expired
            db.prepare("UPDATE cards SET last_verified_at = ? WHERE id = ?").run(new Date(0).toISOString(), target);
            (0, db_1.closeDatabase)();
            console.log(`Marked card "${target}" as needing verification.`);
            console.log(`  Reason: ${reason}`);
            break;
        }
        case 'create_trace': {
            const today = new Date().toISOString().split('T')[0];
            const traceDir = path.join(pmemPath, 'traces');
            (0, fs_1.ensureDir)(traceDir);
            const fs = require('fs');
            const existingTraces = fs.readdirSync(traceDir)
                .filter((f) => f.startsWith(today))
                .length;
            const traceNum = String(existingTraces + 1).padStart(3, '0');
            const traceFile = path.join(traceDir, `${today}-${traceNum}.md`);
            (0, fs_1.atomicWrite)(traceFile, `---
id: trace.${today}-${traceNum}
type: trace
created: ${today}
---

# Trace: ${reason}

## What Changed
${reason}

## Next
Continue as planned.
`);
            console.log(`Auto-created trace: traces/${today}-${traceNum}.md`);
            console.log(`  Reason: ${reason}`);
            // Resolve the associated dirty flags
            const db = (0, db_1.openDatabase)(pmemPath);
            const activeSession = (0, db_1.getActiveSession)(db);
            // Resolve all dirty flags matching this target+reason
            (0, db_1.resolveDirtyFlags)(db, 'card', target);
            (0, db_1.insertUpdateLog)(db, 'auto_trace', reason, activeSession?.id, [`trace.${today}-${traceNum}`], true);
            (0, db_1.closeDatabase)();
            break;
        }
        case 'update_state': {
            console.log(`Action required: ${reason}`);
            console.log('  Please run `pmem update --confirm` to update state.md.');
            break;
        }
        case 'update_next': {
            console.log(`Action required: ${reason}`);
            console.log('  Please run `pmem update --confirm --next "<next step>"` to update next.md.');
            break;
        }
        default: {
            console.log(`Unknown action "${action}" for suggestion ${suggestionId}.`);
            process.exit(2);
        }
    }
    process.exit(0);
}
// === v0.6.3: Edge Confirmation Management ===
function manageEdges(pmemPath, acceptRaw, rejectRaw) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        console.log('No SQLite database. Run `pmem rebuild` first.');
        process.exit(2);
    }
    const db = (0, db_1.openDatabase)(pmemPath);
    // Accept edges: upgrade from inferred to explicit
    if (acceptRaw) {
        const ids = parseEdgeIds(acceptRaw);
        if (ids.length > 0) {
            const changed = (0, db_1.updateEdgeSource)(db, ids, 'explicit', 1.0);
            console.log(`Accepted ${changed} edge(s): upgraded source to explicit, confidence to 1.0.`);
        }
    }
    // Reject edges: delete them
    if (rejectRaw) {
        const ids = parseEdgeIds(rejectRaw);
        if (ids.length > 0) {
            const deleted = (0, db_1.deleteEdgesByIds)(db, ids);
            console.log(`Rejected ${deleted} edge(s): deleted.`);
        }
    }
    (0, db_1.closeDatabase)();
    if (!acceptRaw && !rejectRaw) {
        // Show current inferred edges for review
        const db2 = (0, db_1.openDatabase)(pmemPath);
        const inferred = (0, db_1.getInferredEdges)(db2);
        if (inferred.length === 0) {
            console.log('No inferred edges to review.');
        }
        else {
            console.log(`Inferred edges (${inferred.length} total):\n`);
            const getCardTitle = (cid) => {
                try {
                    const row = db2.prepare('SELECT title FROM cards WHERE id = ?').get(cid);
                    return row?.title ?? cid;
                }
                catch {
                    return cid;
                }
            };
            for (const edge of inferred) {
                console.log(`  [${edge.id}] ${edge.from_id} → ${edge.to_id}`);
                console.log(`      type: ${edge.type}, confidence: ${edge.confidence.toFixed(1)}, source: ${edge.source}`);
            }
            console.log('\nTo accept: pmem update --confirm --accept-edges <id1,id2>');
            console.log('To reject: pmem update --confirm --reject-edges <id1,id2>');
        }
        (0, db_1.closeDatabase)();
    }
}
function parseEdgeIds(raw) {
    return raw
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);
}
// Add edge-related suggestions to the suggestion report.
// All inferred edges are surfaced (not just low-confidence), so the agent
// can review and decide which to accept / reject. Confidence and source are
// included as `sources[]` entries to drive the agent's judgment.
function enrichWithEdgeSuggestions(pmemPath, report) {
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath))
        return report;
    try {
        const db = (0, db_1.openDatabase)(pmemPath);
        const inferred = (0, db_1.getInferredEdges)(db);
        if (inferred.length === 0)
            return report;
        for (const edge of inferred) {
            const isLow = edge.confidence < 0.7;
            const reasonTag = isLow
                ? `inferred_edge_low_confidence: ${edge.from_id} → ${edge.to_id}`
                : `inferred_edge_review: ${edge.from_id} → ${edge.to_id}`;
            const detailReason = isLow
                ? `inferred_${edge.type}_confidence_${edge.confidence.toFixed(1)}`
                : `inferred_${edge.type}_confidence_${edge.confidence.toFixed(1)}_source_${edge.source}`;
            report.groups.current_suggestions.push({
                target: edge.from_id,
                reason: reasonTag,
                matched_file: null,
                count: 1,
                severity: isLow ? 'warning' : 'info',
                blocks_verify: false,
                is_duplicate: false,
                is_historical: false,
                created_at_first: edge.created_at || new Date().toISOString(),
                created_at_last: edge.created_at || new Date().toISOString(),
                sources: [{
                        scope: 'edge',
                        target: `${edge.from_id} → ${edge.to_id}`,
                        reason: detailReason,
                        created_at: edge.created_at || new Date().toISOString(),
                        session_id: null,
                    }],
                edge_ids: edge.id !== undefined ? [edge.id] : [],
                edge_tuple: `${edge.from_id} → ${edge.to_id}`,
            });
        }
        report.summary.info += inferred.length;
        report.summary.affected_cards = new Set(inferred.map(e => e.from_id)).size + report.summary.affected_cards;
        return report;
    }
    catch {
        return report;
    }
}
//# sourceMappingURL=update.js.map