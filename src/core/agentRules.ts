import * as path from 'path';
import * as fs from 'fs';
import { fileExists, readFile, writeFile, ensureDir } from './fs';

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

interface InstallRulesOptions {
  claude?: boolean;
  codex?: boolean;
  gemini?: boolean;
  cursor?: boolean;
  cline?: boolean;
  aider?: boolean;
  windsurf?: boolean;
  all?: boolean;
}

export function writeAgentRules(cwd: string, options: InstallRulesOptions): string[] {
  const installed: string[] = [];

  const targets: Array<{
    name: string;
    filePath: string;
    isMdc?: boolean;
    optIn?: boolean;
  }> = [
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
    if (t.name === 'AGENTS.md') return true;

    // Aider and Windsurf are strictly opt-in and NEVER written via --all
    if (t.name === 'CONVENTIONS.md (Aider)') return !!options.aider;
    if (t.name === '.windsurfrules') return !!options.windsurf;

    // For all other targets, they are written if --all is passed or their specific flag is passed
    if (options.all) return true;

    if (t.name === 'CLAUDE.md') return !!options.claude;
    if (t.name === 'GEMINI.md') return !!options.gemini;
    if (t.name === '.codex/instructions.md') return !!options.codex;
    if (t.name === '.cursor/rules/pmem.mdc') return !!options.cursor;
    if (t.name === '.clinerules/pmem.md') return !!options.cline;

    return false;
  });

  for (const target of selectedTargets) {
    try {
      const dir = path.dirname(target.filePath);
      ensureDir(dir);

      const contentToWrite = target.isMdc ? CURSOR_MDC_CONTENT : RULES_CONTENT;

      if (fileExists(target.filePath)) {
        const existing = readFile(target.filePath) || '';
        const startMarker = '<!-- pmem:rules:start -->';
        const endMarker = '<!-- pmem:rules:end -->';
        const startIndex = existing.indexOf(startMarker);
        const endIndex = existing.indexOf(endMarker);

        if (startIndex >= 0 && endIndex >= 0 && endIndex > startIndex) {
          const updated = existing.substring(0, startIndex) +
            contentToWrite +
            existing.substring(endIndex + endMarker.length);
          writeFile(target.filePath, updated);
        } else {
          // Append rules at the end
          const spacer = existing.endsWith('\n') ? '' : '\n';
          writeFile(target.filePath, `${existing}${spacer}\n${contentToWrite}\n`);
        }
      } else {
        writeFile(target.filePath, contentToWrite + '\n');
      }

      installed.push(target.name);
    } catch (err: any) {
      console.error(`Failed to write agent rules to ${target.name}: ${err.message}`);
    }
  }

  return installed;
}
