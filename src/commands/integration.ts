import * as path from 'path';
import { fileExists, ensureDir, writeFile, readFile } from '../core/fs';
import { loadManifest, saveManifest } from '../core/manifest';

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
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
\`\`\`

\`pmem update --suggest\` exits with code 1 when suggestions exist. That is a workflow signal, not a hard failure.

## Session End

\`\`\`bash
pmem update --confirm -s "<what changed>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
\`\`\`

## Slash Commands

Installed under .claude/commands/pmem-*.md. Use /pmem-recall, /pmem-ask <query>, /pmem-update, /pmem-distill during your session.
`;

const SETTINGS_EXAMPLE = '{\n' +
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

Runs the full update workflow:
1. \`pmem status --format json\` to detect changed files
2. \`pmem mark-dirty --auto\` to mark affected cards
3. \`pmem update --suggest --format json\` to get suggestions
4. Guides you to confirm with \`pmem update --confirm -s "<summary>" -n "<next>".\`

Use this after editing code to keep project memory in sync.
`;

const SLASH_DISTILL = `Consolidate work traces into stable memory cards.

Runs \`pmem distill --suggest\` to check for distillation candidates, then guides through confirmation and verification.

Use this after completing a milestone or when traces/ accumulates.
`;

export function integrationCommand(action: string, framework?: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const manifest = loadManifest(pmemPath);
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
        console.log('Available: claude-code, cursor, codex');
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

function listIntegrations(pmemPath: string, manifest: ReturnType<typeof loadManifest>): void {
  if (!manifest) return;

  console.log('Active integrations:');
  for (const active of manifest.integrations.active) {
    const dir = path.join(pmemPath, 'integrations', active);
    const exists = fileExists(dir);
    console.log(`  ${active} ${exists ? '✓' : '(not installed)'}`);
  }

  // List all available integration templates
  const integrationsDir = path.join(pmemPath, 'integrations');
  if (fileExists(integrationsDir)) {
    const fs = require('fs');
    const entries = fs.readdirSync(integrationsDir, { withFileTypes: true });
    const allIntegrations = entries.filter((e: { isDirectory: () => boolean }) => e.isDirectory()).map((e: { name: string }) => e.name);

    const inactive = allIntegrations.filter((i: string) => !manifest!.integrations.active.includes(i));
    if (inactive.length > 0) {
      console.log('\nAvailable (not active):');
      for (const i of inactive) {
        console.log(`  ${i}`);
      }
    }
  }
}

function installIntegration(pmemPath: string, manifest: ReturnType<typeof loadManifest>, framework: string): void {
  if (!manifest) return;

  const integDir = path.join(pmemPath, 'integrations', framework);
  ensureDir(integDir);

  switch (framework) {
    case 'claude-code': {
      writeFile(path.join(integDir, 'CLAUDE.md'), CLAUDE_CODE_TEMPLATE);
      writeFile(path.join(integDir, 'settings.example.json'), SETTINGS_EXAMPLE);

      // Generate slash command files
      const commandsDir = path.join(process.cwd(), '.claude', 'commands');
      ensureDir(commandsDir);
      writeFile(path.join(commandsDir, 'pmem-recall.md'), SLASH_RECALL);
      writeFile(path.join(commandsDir, 'pmem-ask.md'), SLASH_ASK);
      writeFile(path.join(commandsDir, 'pmem-update.md'), SLASH_UPDATE);
      writeFile(path.join(commandsDir, 'pmem-distill.md'), SLASH_DISTILL);
      console.log('  Created .claude/commands/pmem-*.md (4 slash commands)');

      // Also create/update root CLAUDE.md
      const rootClaudePath = path.join(process.cwd(), 'CLAUDE.md');
      if (!fileExists(rootClaudePath)) {
        writeFile(rootClaudePath, CLAUDE_CODE_TEMPLATE);
        console.log('  Created CLAUDE.md in project root.');
      }
      break;
    }
    case 'cursor': {
      const cursorRulesDir = path.join(process.cwd(), '.cursor', 'rules');
      ensureDir(cursorRulesDir);
      writeFile(path.join(cursorRulesDir, 'pmem.mdc'), `# pmem rules\n\nBefore working:\n- Run \`pmem recall --budget 2000\`\n- Run \`pmem ask "<task>"\` if the task is specific\n\nAfter working:\n- Run \`pmem update --auto\`\n- Run \`pmem verify\`\n\nPeriodically:\n- Run \`pmem distill\` to consolidate traces into stable memory cards\n`);
      break;
    }
    case 'codex': {
      writeFile(path.join(integDir, 'AGENTS.md'), `# Codex Instructions\n\nThis project uses pmem.\n\nBefore work: run \`pmem recall --budget 2000\`.\nAfter work: run \`pmem update\`.\n`);
      break;
    }
    default:
      console.log(`Unknown framework: ${framework}`);
      console.log('Available: claude-code, cursor, codex');
      return;
  }

  // Update manifest
  if (!manifest.integrations.active.includes(framework)) {
    manifest.integrations.active.push(framework);
  }
  const v06files: Record<string, string[]> = {
    'claude-code': ['CLAUDE.md', '.claude/settings.json', '.claude/commands/pmem-recall.md', '.claude/commands/pmem-ask.md', '.claude/commands/pmem-update.md', '.claude/commands/pmem-distill.md'],
    'cursor': ['.cursor/rules/pmem.mdc'],
    'codex': ['AGENTS.md'],
  };
  manifest.integrations[framework] = {
    template_version: CURRENT_TEMPLATE_VERSION,
    files: v06files[framework] || [],
  };
  saveManifest(pmemPath, manifest);

  console.log(`✓ Integration "${framework}" installed.`);
  console.log(`  Template: .pmem/integrations/${framework}/`);
}

const CURRENT_TEMPLATE_VERSION = '0.6.0';

function verifyIntegrations(pmemPath: string, manifest: ReturnType<typeof loadManifest>): void {
  if (!manifest) return;

  const cwd = process.cwd();

  console.log('Integration Check:');
  for (const active of manifest.integrations.active) {
    const integDir = path.join(pmemPath, 'integrations', active);
    const exists = fileExists(integDir);

    console.log(`\n  ${active}: ${exists ? 'installed' : 'missing'}`);

    // Template version check
    const installedInfo = manifest.integrations[active] as { template_version?: string } | undefined;
    if (installedInfo?.template_version) {
      const installedVer = installedInfo.template_version;
      if (installedVer !== CURRENT_TEMPLATE_VERSION) {
        console.log(`    Template version: ${installedVer} (current: ${CURRENT_TEMPLATE_VERSION})`);
        console.log(`    ⚠ Template is outdated. Run: pmem integration install ${active}`);
      } else {
        console.log(`    Template version: ${installedVer} (up to date)`);
      }
    }

    if (active === 'claude-code') {
      const claudeMdExists = fileExists(path.join(cwd, 'CLAUDE.md'));
      const settingsExists = fileExists(path.join(cwd, '.claude', 'settings.json'));
      const slashRecallExists = fileExists(path.join(cwd, '.claude', 'commands', 'pmem-recall.md'));
      const slashAskExists = fileExists(path.join(cwd, '.claude', 'commands', 'pmem-ask.md'));
      const slashUpdateExists = fileExists(path.join(cwd, '.claude', 'commands', 'pmem-update.md'));
      const slashDistillExists = fileExists(path.join(cwd, '.claude', 'commands', 'pmem-distill.md'));
      const slashCount = [slashRecallExists, slashAskExists, slashUpdateExists, slashDistillExists].filter(Boolean).length;
      console.log(`    CLAUDE.md: ${claudeMdExists ? '✓' : '✗'}`);
      console.log(`    .claude/settings.json: ${settingsExists ? '✓' : '✗'}`);
      console.log(`    .claude/commands/pmem-*.md: ${slashCount}/4 slash commands`);
      if (slashCount < 4) {
        if (!slashRecallExists) console.log('      ✗ pmem-recall.md');
        if (!slashAskExists) console.log('      ✗ pmem-ask.md');
        if (!slashUpdateExists) console.log('      ✗ pmem-update.md');
        if (!slashDistillExists) console.log('      ✗ pmem-distill.md');
        console.log('      Fix: run `pmem integration install claude-code`');
      }
    }

    if (active === 'cursor') {
      const rulesExists = fileExists(path.join(cwd, '.cursor', 'rules', 'pmem.mdc'));
      console.log(`    .cursor/rules/pmem.mdc: ${rulesExists ? '✓' : '✗'}`);
      if (!rulesExists) console.log('      Fix: run `pmem integration install cursor`');
    }
    if (active === 'codex') {
      const agentsExists = fileExists(path.join(cwd, 'AGENTS.md'));
      console.log(`    AGENTS.md: ${agentsExists ? '✓' : '✗'}`);
      if (!agentsExists) console.log('      Fix: run `pmem integration install codex`');
    }
  }

  if (manifest.integrations.active.length === 0) {
    console.log('  No active integrations.');
    console.log('  Run: pmem integration install <framework>');
  }
}
