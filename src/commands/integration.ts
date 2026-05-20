import * as path from 'path';
import { fileExists, ensureDir, writeFile, readFile } from '../core/fs';
import { loadManifest, saveManifest } from '../core/manifest';

const PMEM_DIR = '.pmem';

const CLAUDE_CODE_TEMPLATE = `# Claude Code Instructions

This repository uses pmem for project memory.

## Before starting a task
Run:

\`\`\`bash
pmem recall --budget 2000
\`\`\`

If the task is specific, run:

\`\`\`bash
pmem ask "<user task>"
\`\`\`

Read only the memory cards returned by pmem unless more context is required.

## After completing a task

Run:

\`\`\`bash
pmem update --auto
pmem verify
\`\`\`

Periodically run:

\`\`\`bash
pmem distill
\`\`\`

If architecture, product direction, or module boundaries changed, create a decision card.
`;

const SETTINGS_EXAMPLE = `{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pmem update --auto && pmem verify"
          }
        ]
      }
    ]
  }
}
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
    manifest.integrations[framework] = {
      template_version: '0.1.0',
      files: framework === 'claude-code' ? ['CLAUDE.md', '.claude/settings.json'] : ['.cursor/rules/pmem.mdc'],
    };
    saveManifest(pmemPath, manifest);
  }

  console.log(`✓ Integration "${framework}" installed.`);
  console.log(`  Template: .pmem/integrations/${framework}/`);
}

function verifyIntegrations(pmemPath: string, manifest: ReturnType<typeof loadManifest>): void {
  if (!manifest) return;

  const cwd = process.cwd();

  console.log('Integration Check:');
  for (const active of manifest.integrations.active) {
    const integDir = path.join(pmemPath, 'integrations', active);
    const exists = fileExists(integDir);

    console.log(`\n  ${active}: ${exists ? 'installed' : 'missing'}`);

    if (active === 'claude-code') {
      const claudeMdExists = fileExists(path.join(cwd, 'CLAUDE.md'));
      const settingsExists = fileExists(path.join(cwd, '.claude', 'settings.json'));
      console.log(`    CLAUDE.md: ${claudeMdExists ? '✓' : '✗'}`);
      console.log(`    .claude/settings.json: ${settingsExists ? '✓' : '✗'}`);
    }

    if (active === 'cursor') {
      const rulesExists = fileExists(path.join(cwd, '.cursor', 'rules', 'pmem.mdc'));
      console.log(`    .cursor/rules/pmem.mdc: ${rulesExists ? '✓' : '✗'}`);
    }
  }

  if (manifest.integrations.active.length === 0) {
    console.log('  No active integrations.');
    console.log('  Run: pmem integration install <framework>');
  }
}
