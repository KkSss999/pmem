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
exports.milestoneCommand = milestoneCommand;
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const db_1 = require("../core/db");
const PMEM_DIR = '.pmem';
function milestoneCommand(version, options = {}) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    const manifest = (0, manifest_1.loadManifest)(pmemPath);
    if (!manifest) {
        console.log('No manifest found. Run `pmem init` first.');
        process.exit(2);
    }
    const config = (0, manifest_1.resolveConfig)(manifest);
    // Determine the directory for milestone/trace cards
    const traceDirName = config.type_dirs['trace'] || config.type_dirs['milestone'] || 'traces';
    const traceDir = path.join(pmemPath, traceDirName);
    (0, fs_1.ensureDir)(traceDir);
    const today = new Date().toISOString().split('T')[0];
    const milestoneId = `milestone.v${version.replace(/^v/, '')}`;
    const message = options.message || `Released version ${version}`;
    const tag = options.tag || `v${version.replace(/^v/, '')}`;
    // Check if git tag exists
    let gitInfo = '';
    try {
        const gitDir = (0, child_process_1.execSync)('git rev-parse --git-dir', { cwd, stdio: 'ignore', encoding: 'utf8' }).trim();
        if (gitDir) {
            try {
                const tagSha = (0, child_process_1.execSync)(`git rev-parse refs/tags/${tag}`, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
                gitInfo = `\n## Git Tag\n- Tag: \`${tag}\`\n- Commit: \`${tagSha.slice(0, 8)}\``;
            }
            catch {
                // Tag doesn't exist yet — record the current HEAD instead
                try {
                    const headSha = (0, child_process_1.execSync)('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
                    gitInfo = `\n## Git\n- HEAD: \`${headSha.slice(0, 8)}\`\n- Tag \`${tag}\` not yet created (use \`git tag ${tag}\` to create it)`;
                }
                catch {
                    // no git info available
                }
            }
        }
    }
    catch {
        // not a git repo
    }
    const milestoneFile = path.join(traceDir, `milestone.${milestoneId}.md`);
    if ((0, fs_1.fileExists)(milestoneFile)) {
        console.log(`Milestone card already exists: ${path.relative(cwd, milestoneFile)}`);
        console.log(`  Edit it directly or use a different version.`);
        process.exit(2);
    }
    (0, fs_1.atomicWrite)(milestoneFile, `---
id: ${milestoneId}
type: milestone
status: shipped
created: ${today}
tags: [release, ${tag}]
---

# Milestone: ${version}

## What
${message}

## When
Released ${today}.
${gitInfo}
## Next
Continue development toward the next milestone.
`);
    console.log(`Milestone recorded: ${path.relative(cwd, milestoneFile)}`);
    console.log(`  Version: ${version}`);
    console.log(`  ID: ${milestoneId}`);
    // Also create edges to relevant cards if DB exists
    const dbPath = path.join(pmemPath, 'pmem.db');
    if ((0, fs_1.fileExists)(dbPath)) {
        try {
            const db = (0, db_1.openDatabase)(pmemPath);
            (0, db_1.createSchema)(db);
            // Rebuild to index the new card
            const { rebuildCommand } = require('./rebuild');
            rebuildCommand({ card: milestoneId });
            // Link to feature cards that match this version
            const featureCards = db.prepare("SELECT id FROM cards WHERE type = 'feature' AND id LIKE ? AND is_deleted = 0").all(`%${version.replace(/^v/, '')}%`);
            const now = new Date().toISOString();
            for (const fc of featureCards) {
                (0, db_1.insertEdge)(db, {
                    from_id: milestoneId,
                    to_id: fc.id,
                    type: 'implements',
                    source: 'inferred',
                    confidence: 0.9,
                    created_at: now,
                    updated_at: now,
                });
            }
            if (featureCards.length > 0) {
                console.log(`  Linked to ${featureCards.length} feature card(s): ${featureCards.map(f => f.id).join(', ')}`);
            }
            (0, db_1.closeDatabase)();
        }
        catch {
            // DB operations are best-effort
        }
    }
    console.log(`\nRun \`pmem rebuild\` to index the new milestone card.`);
    process.exit(0);
}
//# sourceMappingURL=milestone.js.map