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
exports.doctorCommand = doctorCommand;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const db_1 = require("../core/db");
const PMEM_DIR = '.pmem';
function doctorCommand(format = 'compact') {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const checks = [];
    // 1. .pmem/ exists
    if (!(0, fs_1.fileExists)(pmemPath)) {
        checks.push({ name: 'pmem_dir', status: 'error', message: '.pmem/ directory not found.', fix: 'Run: pmem init <project-name>' });
        outputDoctor(checks, format);
        return;
    }
    checks.push({ name: 'pmem_dir', status: 'ok', message: '.pmem/ directory exists.' });
    // 2. Manifest
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        checks.push({ name: 'manifest', status: 'error', message: 'manifest.yml not found or invalid.', fix: 'Run: pmem init' });
    }
    else {
        const schemaVer = manifest.pmem?.schema_version;
        checks.push({
            name: 'manifest',
            status: schemaVer ? 'ok' : 'warn',
            message: schemaVer ? `manifest.yml valid (schema ${schemaVer}).` : 'manifest.yml valid but missing schema_version.',
            fix: schemaVer ? undefined : 'Run: pmem migrate --to 0.3',
        });
    }
    // 3. Database
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        checks.push({ name: 'database', status: 'warn', message: 'pmem.db not found.', fix: 'Run: pmem rebuild' });
    }
    else {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
            // Card count
            const cardRow = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0').get();
            const cardCount = cardRow?.count ?? 0;
            const isCandidate = db.prepare('SELECT COUNT(*) as count FROM cards WHERE is_deleted = 0 AND is_candidate = 1').get();
            checks.push({
                name: 'database',
                status: 'ok',
                message: `pmem.db healthy. ${cardCount} card(s)${isCandidate?.count > 0 ? ` (${isCandidate.count} candidate(s))` : ''}.`,
            });
            // 4. Cards
            if (cardCount === 0) {
                checks.push({ name: 'cards', status: 'warn', message: 'No memory cards found.', fix: 'Create a module card with source_files, then run: pmem rebuild' });
            }
            else {
                checks.push({ name: 'cards', status: 'ok', message: `${cardCount} active card(s).` });
            }
            // 5. Dirty flags
            const dirtyRow = db.prepare('SELECT COUNT(*) as count FROM dirty_flags WHERE resolved_at IS NULL').get();
            const dirtyCount = dirtyRow?.count ?? 0;
            if (dirtyCount > 0) {
                checks.push({ name: 'dirty_flags', status: 'warn', message: `${dirtyCount} unresolved dirty flag(s).`, fix: 'Run: pmem update --suggest' });
            }
            else {
                checks.push({ name: 'dirty_flags', status: 'ok', message: 'No unresolved dirty flags.' });
            }
            // 6. Active session
            const sessionRow = db.prepare("SELECT id, agent_name FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get();
            if (sessionRow) {
                checks.push({ name: 'session', status: 'ok', message: `Active session: ${sessionRow.id}${sessionRow.agent_name ? ` (${sessionRow.agent_name})` : ''}.` });
            }
            else {
                checks.push({ name: 'session', status: 'warn', message: 'No active session.', fix: 'Run: pmem session start -a "<agent-name>"' });
            }
            (0, db_1.closeDatabase)();
        }
        catch {
            checks.push({ name: 'database', status: 'error', message: 'pmem.db is corrupted or not a valid database.', fix: 'Back up the file, then run: pmem rebuild --full' });
        }
    }
    // 7. Git availability
    try {
        (0, child_process_1.execSync)('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
        checks.push({ name: 'git', status: 'ok', message: 'Git repository detected.' });
    }
    catch {
        checks.push({ name: 'git', status: 'warn', message: 'Not a Git repository.', fix: 'pmem status and mark-dirty --auto will use mtime fallback.' });
    }
    // 7b. Lock status (v0.6.4 polish 6: richer output with age, owner, suggestions)
    const lockPath = path.join(pmemPath, '.lock');
    const lockInfo = (0, fs_1.getLockInfo)(lockPath);
    if (!lockInfo.exists) {
        checks.push({ name: 'lock', status: 'ok', message: 'No lock held.' });
    }
    else if (lockInfo.is_stale) {
        const ageSec = lockInfo.age_seconds !== null ? lockInfo.age_seconds : '?';
        const ownerLabel = lockInfo.owner_pid !== null ? `pmem (PID: ${lockInfo.owner_pid})` : 'pmem (PID: unknown)';
        checks.push({
            name: 'lock',
            status: 'warn',
            message: `Stale lock held at .pmem/.lock\n        Owner: ${ownerLabel}\n        Age: ${ageSec}s (stale threshold: ${lockInfo.stale_threshold_seconds}s)`,
            fix: 'Run: pmem verify --fix-locks  (to clean stale lock)\n       Or: pmem doctor (to diagnose lock status)',
        });
    }
    else {
        const ageSec = lockInfo.age_seconds !== null ? lockInfo.age_seconds : '?';
        const ownerLabel = lockInfo.owner_pid !== null ? `pmem (PID: ${lockInfo.owner_pid})` : 'pmem (PID: unknown)';
        const pidHint = lockInfo.owner_pid !== null ? `\n        → Or check process: ps -p ${lockInfo.owner_pid}` : '';
        checks.push({
            name: 'lock',
            status: 'warn',
            message: `Active lock held at .pmem/.lock\n        Owner: ${ownerLabel}\n        Age: ${ageSec}s (stale threshold: ${lockInfo.stale_threshold_seconds}s)`,
            fix: `If another pmem is not actually running, wait ${lockInfo.stale_threshold_seconds}s and run: pmem verify --fix-locks${pidHint}`,
        });
    }
    // 8. Integrations
    if (manifest && manifest.integrations?.active?.length > 0) {
        const active = manifest.integrations.active;
        checks.push({ name: 'integrations', status: 'ok', message: `${active.length} active: ${active.join(', ')}.` });
    }
    else {
        checks.push({ name: 'integrations', status: 'warn', message: 'No integrations installed.', fix: 'Run: pmem integration install <framework>' });
    }
    outputDoctor(checks, format);
}
function outputDoctor(checks, format) {
    if (format === 'json') {
        const okCount = checks.filter(c => c.status === 'ok').length;
        const warnCount = checks.filter(c => c.status === 'warn').length;
        const errorCount = checks.filter(c => c.status === 'error').length;
        console.log(JSON.stringify({
            overall: errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
            summary: `${okCount} ok, ${warnCount} warning(s), ${errorCount} error(s)`,
            checks: checks.map(c => ({
                name: c.name,
                status: c.status,
                message: c.message,
                ...(c.fix ? { fix: c.fix } : {}),
            })),
        }, null, 2));
    }
    else {
        const icons = { ok: '✓', warn: '⚠', error: '✗' };
        for (const check of checks) {
            console.log(`${icons[check.status]} ${check.message}`);
            if (check.fix)
                console.log(`  ${check.fix}`);
        }
        const errorCount = checks.filter(c => c.status === 'error').length;
        const warnCount = checks.filter(c => c.status === 'warn').length;
        if (errorCount > 0 || warnCount > 0) {
            process.exit(errorCount > 0 ? 2 : 1);
        }
    }
}
//# sourceMappingURL=doctor.js.map