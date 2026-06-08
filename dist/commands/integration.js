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
exports.integrationCommand = integrationCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
const yaml_1 = require("../core/yaml");
const PMEM_DIR = '.pmem';
const CLAUDE_CODE_TEMPLATE = `# pmem integration for Claude Code

This project uses pmem for project memory. Markdown cards under .pmem/ are the source of truth; .pmem/pmem.db is a rebuildable SQLite runtime index.

## Session Start

\`\`\`bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
\`\`\`

## Before Focused Work

\`\`\`bash
pmem ask "<task or module>" --format compact
\`\`\`

## After Editing Code

\`\`\`bash
# Recommended: sync changes in one command
pmem sync -s "<what changed>" -n "<next step>"

# Or manual: pmem status --format json && pmem mark-dirty --auto && pmem update --suggest
\`\`\`

## Session End

\`\`\`bash
pmem session end -s "<task summary>"
pmem verify
\`\`\`

## Slash Commands

Installed under .claude/commands/pmem-*.md. Use /pmem-recall, /pmem-ask <query>, /pmem-update, /pmem-distill during your session.
`;
const SETTINGS_JSON = '{\n' +
    '  "hooks": {\n' +
    '    "PostToolUse": [{\n' +
    '      "matcher": "Edit|Write",\n' +
    '      "command": "cd ${CLAUDE_PROJECT_DIR} && pmem mark-dirty -r \\"File modified by Claude\\""\n' +
    '    }]\n' +
    '  }\n' +
    '}\n';
// === Claude Code Slash Command templates ===
const SLASH_RECALL = `Recall the current project memory context.

Run \`pmem recall --format compact --budget 2000\` to restore project state, focus, and next steps.

Use this at the start of every session to restore context across sessions.
`;
const SLASH_ASK = `Search project memory for a specific topic.

Usage: /pmem-ask <query>

Runs \`pmem ask "<query>" --format compact\` to find relevant memory cards by ID, alias, tag, graph neighbor, and keyword fallback.

Use this before working on a specific module or task to load relevant decisions and context.
`;
const SLASH_UPDATE = `Detect code changes and update project memory.

Runs the full update workflow (or run \`pmem sync -s "<summary>" -n "<next>"\` directly).
Manual flow:
1. \`pmem status --format json\` to detect changed files
2. \`pmem mark-dirty --auto\` to mark affected cards
3. \`pmem update --suggest --format json\` to get suggestions
4. Guides you to confirm with \`pmem update --confirm -s "<summary>" -n "<next>".\`

Use this after editing code to keep project memory in sync.
`;
const GIT_HOOK_PRECOMMIT = `#!/bin/sh
# pmem pre-commit hook — verify memory consistency before commit
# Installed by: pmem integration install git-hooks
pmem verify --relaxed
`;
const SLASH_DISTILL = `Consolidate work traces into stable memory cards.

Runs \`pmem distill --suggest\` to check for distillation candidates, then guides through confirmation and verification.

Use this after completing a milestone or when traces/ accumulates.
`;
const CURSOR_RULES_TEMPLATE = `# pmem rules

Before working:
- Run \`pmem recall --budget 2000\`
- Run \`pmem ask "<task>"\` if the task is specific

After working:
- Run \`pmem sync -s "<what changed>" -n "<next step>"\` (or use manual status/dirty/update flow)
- Run \`pmem verify\`

Periodically:
- Run \`pmem distill\` to consolidate traces into stable memory cards
`;
const CODEX_AGENTS_TEMPLATE = `# Codex Instructions

This project uses pmem.

Before work: run \`pmem recall --budget 2000\`.
After work: run \`pmem sync -s "<summary>" -n "<next>"\` or \`pmem update\`.

## Commands

To invoke pmem from Codex, run the following commands:

- \`pmem recall --format compact --budget 2000\` — recall project memory context
- \`pmem ask "<query>" --format compact\` — search for a specific topic
- \`pmem sync -s "<summary>" -n "<next>"\` — sync and update memory in one command
- \`pmem update --auto\` — detect changes and update memory
- \`pmem distill --suggest\` — consolidate work traces into stable memory cards
`;
function integrationCommand(action, framework) {
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
    switch (action) {
        case 'list':
            listIntegrations(pmemPath, manifest);
            break;
        case 'install':
            if (!framework) {
                console.log('Usage: pmem integration install <framework>');
                console.log('Available: claude-code, cursor, codex, git-hooks');
                return;
            }
            installIntegration(pmemPath, manifest, framework);
            break;
        case 'verify':
            verifyIntegrations(pmemPath, manifest);
            break;
        default:
            console.log(`Unknown integration action: ${action}`);
    }
}
function listIntegrations(pmemPath, manifest) {
    if (!manifest)
        return;
    console.log('Active integrations:');
    for (const active of manifest.integrations.active) {
        const dir = path.join(pmemPath, 'integrations', active);
        const exists = (0, fs_1.fileExists)(dir);
        console.log(`  ${active} ${exists ? '✓' : '(not installed)'}`);
    }
    // List all available integration templates
    const integrationsDir = path.join(pmemPath, 'integrations');
    if ((0, fs_1.fileExists)(integrationsDir)) {
        const fs = require('fs');
        const entries = fs.readdirSync(integrationsDir, { withFileTypes: true });
        const allIntegrations = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const inactive = allIntegrations.filter((i) => !manifest.integrations.active.includes(i));
        if (inactive.length > 0) {
            console.log('\nAvailable (not active):');
            for (const i of inactive) {
                console.log(`  ${i}`);
            }
        }
    }
}
// === Polish 2 helpers: version frontmatter + JSON ===
function withVersionFrontmatter(content, version) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const inner = fmMatch[1];
        const newInner = `pmem_integration_version: "${version}"\n` + inner;
        return `---\n${newInner}---` + content.slice(fmMatch[0].length);
    }
    return `---\npmem_integration_version: "${version}"\n---\n\n${content}`;
}
function withVersionJson(content, version) {
    try {
        const data = JSON.parse(content);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const reordered = {
                pmem_integration_version: version,
                ...data,
            };
            return JSON.stringify(reordered, null, 2) + '\n';
        }
    }
    catch {
        // fallthrough
    }
    return content;
}
function readFileVersion(filePath) {
    const content = (0, fs_1.readFile)(filePath);
    if (content === null)
        return null;
    if (filePath.endsWith('.json')) {
        try {
            const data = JSON.parse(content);
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const v = data.pmem_integration_version;
                return typeof v === 'string' ? v : null;
            }
        }
        catch {
            return null;
        }
        return null;
    }
    const parsed = (0, yaml_1.parseFrontmatter)(content);
    if (!parsed)
        return null;
    const v = parsed.data.pmem_integration_version;
    return typeof v === 'string' ? v : null;
}
function reportFileVersion(filePath, label) {
    if (!(0, fs_1.fileExists)(filePath)) {
        console.log(`    ${label}: ✗ missing`);
        return;
    }
    const version = readFileVersion(filePath);
    if (version === null) {
        console.log(`    ${label}: ✓ exists (version unknown — no pmem_integration_version field)`);
    }
    else if (version === CURRENT_TEMPLATE_VERSION) {
        console.log(`    ${label}: ✓ exists (version ${version})`);
    }
    else {
        console.log(`    ${label}: ⚠ installed file v${version}, current template v${CURRENT_TEMPLATE_VERSION} — mismatch`);
    }
}
function installIntegration(pmemPath, manifest, framework) {
    if (!manifest)
        return;
    const integDir = path.join(pmemPath, 'integrations', framework);
    (0, fs_1.ensureDir)(integDir);
    switch (framework) {
        case 'claude-code': {
            (0, fs_1.writeFile)(path.join(integDir, 'CLAUDE.md'), withVersionFrontmatter(CLAUDE_CODE_TEMPLATE, CURRENT_TEMPLATE_VERSION));
            // Generate .claude/settings.json in project root (single source for Claude Code hook config)
            const claudeSettingsDir = path.join(process.cwd(), '.claude');
            (0, fs_1.ensureDir)(claudeSettingsDir);
            (0, fs_1.writeFile)(path.join(claudeSettingsDir, 'settings.json'), withVersionJson(SETTINGS_JSON, CURRENT_TEMPLATE_VERSION));
            console.log('  Created .claude/settings.json');
            // Generate slash command files
            const commandsDir = path.join(claudeSettingsDir, 'commands');
            (0, fs_1.ensureDir)(commandsDir);
            (0, fs_1.writeFile)(path.join(commandsDir, 'pmem-recall.md'), withVersionFrontmatter(SLASH_RECALL, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(commandsDir, 'pmem-ask.md'), withVersionFrontmatter(SLASH_ASK, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(commandsDir, 'pmem-update.md'), withVersionFrontmatter(SLASH_UPDATE, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(commandsDir, 'pmem-distill.md'), withVersionFrontmatter(SLASH_DISTILL, CURRENT_TEMPLATE_VERSION));
            console.log('  Created .claude/commands/pmem-*.md (4 slash commands)');
            // Also create/update root CLAUDE.md
            const rootClaudePath = path.join(process.cwd(), 'CLAUDE.md');
            if (!(0, fs_1.fileExists)(rootClaudePath)) {
                (0, fs_1.writeFile)(rootClaudePath, withVersionFrontmatter(CLAUDE_CODE_TEMPLATE, CURRENT_TEMPLATE_VERSION));
                console.log('  Created CLAUDE.md in project root.');
            }
            break;
        }
        case 'cursor': {
            const cursorRulesDir = path.join(process.cwd(), '.cursor', 'rules');
            (0, fs_1.ensureDir)(cursorRulesDir);
            (0, fs_1.writeFile)(path.join(cursorRulesDir, 'pmem.mdc'), withVersionFrontmatter(CURSOR_RULES_TEMPLATE, CURRENT_TEMPLATE_VERSION));
            // Polish 3: Cursor 0.46+ supports .cursor/commands/ for slash commands
            const cursorCommandsDir = path.join(process.cwd(), '.cursor', 'commands');
            (0, fs_1.ensureDir)(cursorCommandsDir);
            (0, fs_1.writeFile)(path.join(cursorCommandsDir, 'pmem-recall.md'), withVersionFrontmatter(SLASH_RECALL, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(cursorCommandsDir, 'pmem-ask.md'), withVersionFrontmatter(SLASH_ASK, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(cursorCommandsDir, 'pmem-update.md'), withVersionFrontmatter(SLASH_UPDATE, CURRENT_TEMPLATE_VERSION));
            (0, fs_1.writeFile)(path.join(cursorCommandsDir, 'pmem-distill.md'), withVersionFrontmatter(SLASH_DISTILL, CURRENT_TEMPLATE_VERSION));
            console.log('  Created .cursor/commands/pmem-*.md (4 slash commands)');
            break;
        }
        case 'codex': {
            // Polish 3: Codex does not support .codex/commands/ as a stable feature.
            // Instead, the AGENTS.md has a ## Commands section that lists exact pmem invocations.
            (0, fs_1.writeFile)(path.join(integDir, 'AGENTS.md'), withVersionFrontmatter(CODEX_AGENTS_TEMPLATE, CURRENT_TEMPLATE_VERSION));
            break;
        }
        case 'git-hooks': {
            const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');
            if (!(0, fs_1.fileExists)(gitHooksDir)) {
                console.log('No .git/hooks/ directory found. Is this a git repository?');
                return;
            }
            const precommitPath = path.join(gitHooksDir, 'pre-commit');
            if ((0, fs_1.fileExists)(precommitPath)) {
                // Append to existing hook
                const existing = (0, fs_1.readFile)(precommitPath) || '';
                if (!existing.includes('pmem verify')) {
                    (0, fs_1.writeFile)(precommitPath, existing + '\n' + GIT_HOOK_PRECOMMIT);
                    console.log('  Appended pmem verify to existing .git/hooks/pre-commit');
                }
                else {
                    console.log('  pmem verify already in .git/hooks/pre-commit');
                }
            }
            else {
                (0, fs_1.writeFile)(precommitPath, GIT_HOOK_PRECOMMIT);
                // Make it executable
                try {
                    const fs = require('fs');
                    fs.chmodSync(precommitPath, '755');
                }
                catch {
                    // chmod may fail on some platforms, non-fatal
                }
                console.log('  Created .git/hooks/pre-commit');
            }
            break;
        }
        default:
            console.log(`Unknown framework: ${framework}`);
            console.log('Available: claude-code, cursor, codex, git-hooks');
            return;
    }
    // Update manifest
    if (!manifest.integrations.active.includes(framework)) {
        manifest.integrations.active.push(framework);
    }
    const v06files = {
        'claude-code': ['CLAUDE.md', '.claude/settings.json', '.claude/commands/pmem-recall.md', '.claude/commands/pmem-ask.md', '.claude/commands/pmem-update.md', '.claude/commands/pmem-distill.md'],
        'cursor': ['.cursor/rules/pmem.mdc', '.cursor/commands/pmem-recall.md', '.cursor/commands/pmem-ask.md', '.cursor/commands/pmem-update.md', '.cursor/commands/pmem-distill.md'],
        'codex': ['AGENTS.md'],
        'git-hooks': ['.git/hooks/pre-commit'],
    };
    manifest.integrations[framework] = {
        template_version: CURRENT_TEMPLATE_VERSION,
        files: v06files[framework] || [],
    };
    (0, manifest_1.saveManifest)(pmemPath, manifest);
    console.log(`✓ Integration "${framework}" installed.`);
    console.log(`  Template: .pmem/integrations/${framework}/`);
}
const CURRENT_TEMPLATE_VERSION = '0.7.2';
function verifyIntegrations(pmemPath, manifest) {
    if (!manifest)
        return;
    const cwd = process.cwd();
    console.log('Integration Check:');
    for (const active of manifest.integrations.active) {
        const integDir = path.join(pmemPath, 'integrations', active);
        const exists = (0, fs_1.fileExists)(integDir);
        console.log(`\n  ${active}: ${exists ? 'installed' : 'missing'}`);
        // Template version check
        const installedInfo = manifest.integrations[active];
        if (installedInfo?.template_version) {
            const installedVer = installedInfo.template_version;
            if (installedVer !== CURRENT_TEMPLATE_VERSION) {
                console.log(`    Template version: ${installedVer} (current: ${CURRENT_TEMPLATE_VERSION})`);
                console.log(`    ⚠ Template is outdated. Run: pmem integration install ${active}`);
            }
            else {
                console.log(`    Template version: ${installedVer} (up to date)`);
            }
        }
        if (active === 'claude-code') {
            const claudeMdExists = (0, fs_1.fileExists)(path.join(cwd, 'CLAUDE.md'));
            const settingsExists = (0, fs_1.fileExists)(path.join(cwd, '.claude', 'settings.json'));
            const slashRecallExists = (0, fs_1.fileExists)(path.join(cwd, '.claude', 'commands', 'pmem-recall.md'));
            const slashAskExists = (0, fs_1.fileExists)(path.join(cwd, '.claude', 'commands', 'pmem-ask.md'));
            const slashUpdateExists = (0, fs_1.fileExists)(path.join(cwd, '.claude', 'commands', 'pmem-update.md'));
            const slashDistillExists = (0, fs_1.fileExists)(path.join(cwd, '.claude', 'commands', 'pmem-distill.md'));
            const slashCount = [slashRecallExists, slashAskExists, slashUpdateExists, slashDistillExists].filter(Boolean).length;
            console.log(`    CLAUDE.md: ${claudeMdExists ? '✓' : '✗'}`);
            console.log(`    .claude/settings.json: ${settingsExists ? '✓' : '✗'}`);
            console.log(`    .claude/commands/pmem-*.md: ${slashCount}/4 slash commands`);
            if (slashCount < 4) {
                if (!slashRecallExists)
                    console.log('      ✗ pmem-recall.md');
                if (!slashAskExists)
                    console.log('      ✗ pmem-ask.md');
                if (!slashUpdateExists)
                    console.log('      ✗ pmem-update.md');
                if (!slashDistillExists)
                    console.log('      ✗ pmem-distill.md');
                console.log('      Fix: run `pmem integration install claude-code`');
            }
            // Polish 2: file-level version checks
            console.log('    File versions:');
            reportFileVersion(path.join(cwd, 'CLAUDE.md'), 'CLAUDE.md');
            reportFileVersion(path.join(cwd, '.claude', 'settings.json'), '.claude/settings.json');
            reportFileVersion(path.join(cwd, '.claude', 'commands', 'pmem-recall.md'), '.claude/commands/pmem-recall.md');
            reportFileVersion(path.join(cwd, '.claude', 'commands', 'pmem-ask.md'), '.claude/commands/pmem-ask.md');
            reportFileVersion(path.join(cwd, '.claude', 'commands', 'pmem-update.md'), '.claude/commands/pmem-update.md');
            reportFileVersion(path.join(cwd, '.claude', 'commands', 'pmem-distill.md'), '.claude/commands/pmem-distill.md');
        }
        if (active === 'cursor') {
            const rulesExists = (0, fs_1.fileExists)(path.join(cwd, '.cursor', 'rules', 'pmem.mdc'));
            console.log(`    .cursor/rules/pmem.mdc: ${rulesExists ? '✓' : '✗'}`);
            if (!rulesExists)
                console.log('      Fix: run `pmem integration install cursor`');
            // Polish 3: Cursor 0.46+ .cursor/commands/ slash commands
            const cursorSlashRecall = (0, fs_1.fileExists)(path.join(cwd, '.cursor', 'commands', 'pmem-recall.md'));
            const cursorSlashAsk = (0, fs_1.fileExists)(path.join(cwd, '.cursor', 'commands', 'pmem-ask.md'));
            const cursorSlashUpdate = (0, fs_1.fileExists)(path.join(cwd, '.cursor', 'commands', 'pmem-update.md'));
            const cursorSlashDistill = (0, fs_1.fileExists)(path.join(cwd, '.cursor', 'commands', 'pmem-distill.md'));
            const cursorSlashCount = [cursorSlashRecall, cursorSlashAsk, cursorSlashUpdate, cursorSlashDistill].filter(Boolean).length;
            console.log(`    .cursor/commands/pmem-*.md: ${cursorSlashCount}/4 slash commands`);
            if (cursorSlashCount < 4) {
                if (!cursorSlashRecall)
                    console.log('      ✗ pmem-recall.md');
                if (!cursorSlashAsk)
                    console.log('      ✗ pmem-ask.md');
                if (!cursorSlashUpdate)
                    console.log('      ✗ pmem-update.md');
                if (!cursorSlashDistill)
                    console.log('      ✗ pmem-distill.md');
                console.log('      Fix: run `pmem integration install cursor`');
            }
            // Polish 2: file-level version checks
            console.log('    File versions:');
            reportFileVersion(path.join(cwd, '.cursor', 'rules', 'pmem.mdc'), '.cursor/rules/pmem.mdc');
            reportFileVersion(path.join(cwd, '.cursor', 'commands', 'pmem-recall.md'), '.cursor/commands/pmem-recall.md');
            reportFileVersion(path.join(cwd, '.cursor', 'commands', 'pmem-ask.md'), '.cursor/commands/pmem-ask.md');
            reportFileVersion(path.join(cwd, '.cursor', 'commands', 'pmem-update.md'), '.cursor/commands/pmem-update.md');
            reportFileVersion(path.join(cwd, '.cursor', 'commands', 'pmem-distill.md'), '.cursor/commands/pmem-distill.md');
        }
        if (active === 'codex') {
            const agentsIntegPath = path.join(integDir, 'AGENTS.md');
            const agentsExists = (0, fs_1.fileExists)(agentsIntegPath);
            console.log(`    AGENTS.md (in .pmem/integrations/codex/): ${agentsExists ? '✓' : '✗'}`);
            if (!agentsExists)
                console.log('      Fix: run `pmem integration install codex`');
            // Polish 3: verify AGENTS.md has ## Commands section (Codex fallback for slash commands)
            if (agentsExists) {
                const agentsContent = (0, fs_1.readFile)(agentsIntegPath) || '';
                const hasCommandsSection = /##\s+Commands/.test(agentsContent);
                console.log(`    AGENTS.md ## Commands section: ${hasCommandsSection ? '✓' : '✗'}`);
                if (!hasCommandsSection) {
                    console.log('      Fix: re-run `pmem integration install codex` to regenerate AGENTS.md with ## Commands');
                }
            }
            // Polish 2: file-level version check
            console.log('    File versions:');
            reportFileVersion(agentsIntegPath, 'AGENTS.md');
        }
        if (active === 'git-hooks') {
            const hookExists = (0, fs_1.fileExists)(path.join(cwd, '.git', 'hooks', 'pre-commit'));
            console.log(`    .git/hooks/pre-commit: ${hookExists ? '✓' : '✗'}`);
            if (!hookExists) {
                console.log('      Fix: run `pmem integration install git-hooks`');
            }
            else {
                const content = (0, fs_1.readFile)(path.join(cwd, '.git', 'hooks', 'pre-commit')) || '';
                if (content.includes('pmem verify')) {
                    console.log('    pmem verify hook: ✓');
                }
                else {
                    console.log('    pmem verify hook: ✗ (hook exists but pmem verify not found)');
                }
            }
        }
    }
    if (manifest.integrations.active.length === 0) {
        console.log('  No active integrations.');
        console.log('  Run: pmem integration install <framework>');
    }
}
//# sourceMappingURL=integration.js.map