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
exports.verifyCommand = verifyCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const db_1 = require("../core/db");
const hash_1 = require("../core/hash");
const consistency_1 = require("../core/consistency");
const rebuild_1 = require("./rebuild");
const PMEM_DIR = '.pmem';
function verifyCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        return;
    }
    const issues = [];
    // 1. Check manifest exists
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        issues.push({
            severity: 'error',
            type: 'missing_manifest',
            message: '.pmem/manifest.yml not found or invalid.',
            fix: 'Run: pmem init',
        });
    }
    // 2. Check SQLite DB exists
    const dbPath = path.join(pmemPath, 'pmem.db');
    const dbExists = (0, fs_1.fileExists)(dbPath);
    let db = null;
    if (!dbExists) {
        issues.push({
            severity: 'warning',
            type: 'missing_database',
            message: '.pmem/pmem.db not found.',
            fix: 'Run: pmem rebuild',
        });
    }
    else {
        try {
            db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
        }
        catch (err) {
            issues.push({
                severity: 'error',
                type: 'corrupt_database',
                message: err?.message || '.pmem/pmem.db is corrupted.',
                fix: 'Back up the file if needed, then run: pmem rebuild --full',
            });
            db = null;
        }
    }
    // 2b. Lock status check
    const lockPath = path.join(pmemPath, '.lock');
    const lockStatus = (0, fs_1.getLockStatus)(lockPath);
    if (lockStatus.exists) {
        if (lockStatus.stale) {
            const ageSec = lockStatus.age !== null ? Math.round(lockStatus.age / 1000) : '?';
            if (options.fixLocks) {
                (0, fs_1.breakLock)(lockPath);
                issues.push({
                    severity: 'warning',
                    type: 'stale_lock_cleaned',
                    message: `Stale lock at .pmem/.lock (age: ${ageSec}s) was cleaned.`,
                    fix: 'Lock has been removed. You can now run pmem commands.',
                });
            }
            else {
                issues.push({
                    severity: 'warning',
                    type: 'stale_lock',
                    message: `Stale lock detected at .pmem/.lock (age: ${ageSec}s).`,
                    fix: 'Run: pmem verify --fix-locks (to clean stale lock)\n       Or: pmem doctor (to diagnose lock status)',
                });
            }
        }
        else if (lockStatus.age !== null) {
            const ageSec = Math.round(lockStatus.age / 1000);
            issues.push({
                severity: 'warning',
                type: 'active_lock',
                message: `Active lock at .pmem/.lock (age: ${ageSec}s). Another pmem process may be running.`,
                fix: 'Wait for the other process to finish. If no other process is running, run: pmem verify --fix-locks',
            });
        }
    }
    if (manifest) {
        // 3. Check schema version
        const currentSchema = manifest.pmem?.schema_version;
        if (!currentSchema) {
            issues.push({
                severity: 'warning',
                type: 'missing_schema_version',
                message: 'Manifest is missing pmem.schema_version.',
                fix: 'Run: pmem migrate --to 0.3',
            });
        }
        else if (currentSchema < '0.3') {
            issues.push({
                severity: 'warning',
                type: 'old_schema_version',
                message: `Project schema version is ${currentSchema}. Current CLI supports 0.3.`,
                fix: 'Run: pmem migrate --to 0.3',
            });
        }
        else if (currentSchema > '0.3') {
            issues.push({
                severity: 'error',
                type: 'newer_schema_version',
                message: `Project schema version is ${currentSchema}. Current CLI only supports up to 0.3.`,
                fix: 'Please upgrade pmem CLI to a newer version.',
            });
        }
        if (db) {
            const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all();
            // 4. Hash consistency — compare DB file_hash against actual .md file content
            for (const card of cards) {
                const cardFilePath = path.join(cwd, card.file_path);
                if (!(0, fs_1.fileExists)(cardFilePath)) {
                    issues.push({
                        severity: 'warning',
                        type: 'missing_card_file',
                        message: `Card "${card.id}" references missing file: ${card.file_path}`,
                        fix: 'Run: pmem rebuild',
                    });
                    continue;
                }
                const content = (0, fs_1.readFile)(cardFilePath);
                if (!content)
                    continue;
                const currentFileHash = (0, hash_1.computeHash)(content);
                if (currentFileHash !== card.file_hash) {
                    issues.push({
                        severity: 'warning',
                        type: 'stale_index',
                        message: `Card "${card.id}" file hash mismatch (stored: ${card.file_hash}, current: ${currentFileHash}).`,
                        fix: 'Run: pmem rebuild',
                    });
                }
            }
            // 5. Orphan edges — edges referencing non-existent card IDs
            const orphanFrom = db.prepare('SELECT e.* FROM edges e LEFT JOIN cards c ON e.from_id = c.id WHERE c.id IS NULL').all();
            const orphanTo = db.prepare('SELECT e.* FROM edges e LEFT JOIN cards c ON e.to_id = c.id WHERE c.id IS NULL').all();
            const orphanEdgeSet = new Map();
            for (const e of orphanFrom) {
                if (e.id !== undefined)
                    orphanEdgeSet.set(e.id, e);
            }
            for (const e of orphanTo) {
                if (e.id !== undefined && !orphanEdgeSet.has(e.id))
                    orphanEdgeSet.set(e.id, e);
            }
            if (orphanEdgeSet.size > 0) {
                issues.push({
                    severity: 'warning',
                    type: 'orphan_edges',
                    message: `${orphanEdgeSet.size} edge(s) reference non-existent card IDs.`,
                    fix: 'Run: pmem rebuild',
                });
            }
            // 6. Card policy checks
            if (manifest.card_policy) {
                const policy = manifest.card_policy;
                // 6a. ID naming pattern
                const idRegex = new RegExp(policy.id_pattern);
                for (const card of cards) {
                    if (!idRegex.test(card.id)) {
                        issues.push({
                            severity: 'warning',
                            type: 'card_id_violation',
                            message: `Card "${card.id}" does not match naming pattern.`,
                            fix: `Rename card ID to match: ${policy.id_pattern}`,
                        });
                    }
                }
                // 6b. Token count limits — read files and estimate tokens
                const relaxedMultiplier = options.relaxed ? 2 : 1;
                for (const card of cards) {
                    const filePath = path.join(cwd, card.file_path);
                    const content = (0, fs_1.readFile)(filePath);
                    if (content) {
                        const estimatedTokens = (0, hash_1.tokenCount)(content);
                        const maxForType = policy.max_tokens[card.type];
                        const effectiveMax = maxForType ? maxForType * relaxedMultiplier : undefined;
                        if (effectiveMax && estimatedTokens > effectiveMax) {
                            issues.push({
                                severity: 'warning',
                                type: 'card_too_large',
                                message: `Card "${card.id}" is ~${estimatedTokens} tokens (max for ${card.type}: ${maxForType}${options.relaxed ? ', relaxed: ' + effectiveMax : ''}).`,
                                fix: `Edit .pmem/manifest.yml → card_policy → max_tokens → ${card.type} to raise the limit.\n       Or run: pmem verify --relaxed (temporarily doubles all limits).\n       Or run: pmem distill --suggest-splits (check if this card can be split).`,
                            });
                        }
                    }
                }
                // 6c. Relation count threshold
                for (const card of cards) {
                    const { count: relatedEdgeCount } = db.prepare('SELECT COUNT(*) as count FROM edges WHERE from_id = ? OR to_id = ?').get(card.id, card.id);
                    if (relatedEdgeCount > policy.warn_when_related_count_gt) {
                        issues.push({
                            severity: 'warning',
                            type: 'too_many_relations',
                            message: `Card "${card.id}" has ${relatedEdgeCount} relations (threshold: ${policy.warn_when_related_count_gt}).`,
                            fix: 'Review whether all relations are necessary.',
                        });
                    }
                }
            }
            // 9. Stale memory: source files newer than card update time
            // Uses shared consistency check to stay aligned with update --suggest
            const staleMemoryIssues = (0, consistency_1.checkStaleMemory)(pmemPath);
            for (const ci of staleMemoryIssues) {
                issues.push({
                    severity: 'warning',
                    type: ci.type,
                    message: ci.message,
                    fix: ci.card_id ? `Run: pmem update --confirm to update ${ci.card_id}.` : 'Run: pmem rebuild',
                });
            }
        }
        // 7. Check AGENTS.md exists
        if (!(0, fs_1.fileExists)(path.join(cwd, 'AGENTS.md'))) {
            issues.push({
                severity: 'warning',
                type: 'missing_agents',
                message: 'AGENTS.md not found in project root.',
                fix: 'Run: pmem init',
            });
        }
        // 8. Check memory_status.dirty
        if (manifest.memory_status?.dirty) {
            issues.push({
                severity: 'warning',
                type: 'memory_dirty',
                message: `Memory is marked dirty since ${manifest.memory_status.dirty_since || 'unknown'}. Reason: ${manifest.memory_status.dirty_reason || 'unknown'}.`,
                fix: 'Run: pmem update --auto (to detect changes) or pmem update --confirm (to record updates).',
            });
        }
    }
    // Build result
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const passed = errors.length === 0;
    const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 5);
    const result = { passed, score, issues };
    // Output
    if (passed && warnings.length === 0) {
        console.log(`✓ Memory verification passed.`);
        console.log(`  Score: ${score}/100`);
        return;
    }
    console.log(`Memory Verify Result: ${passed ? 'Warnings found' : 'Failed'}`);
    console.log(`Score: ${score}/100`);
    console.log('');
    for (const issue of issues) {
        const icon = issue.severity === 'error' ? '✗' : '⚠';
        console.log(`${icon} [${issue.type}] ${issue.message}`);
        console.log(`  Fix: ${issue.fix}`);
        console.log('');
    }
    // Auto-fix if requested (--fix or --fix-locks)
    if (options.fix) {
        const fixableIssue = issues.find(i => i.type === 'stale_index' ||
            i.type === 'missing_database' ||
            i.type === 'missing_card_file' ||
            i.type === 'orphan_edges');
        if (fixableIssue) {
            console.log('Auto-fixing: rebuilding indexes...');
            (0, rebuild_1.rebuildCommand)();
        }
    }
    // --fix-locks cleans stale locks during the check pass above,
    // but if a stale lock was found and not cleaned (e.g., --fix-locks not passed),
    // we provide guidance here.
    const hasErrors = issues.some(i => i.severity === 'error');
    const hasWarnings = issues.some(i => i.severity === 'warning');
    // v0.6.2: warnings no longer trigger exit 1. Only errors exit non-zero.
    if (hasErrors)
        process.exit(2);
    process.exit(0);
}
//# sourceMappingURL=verify.js.map