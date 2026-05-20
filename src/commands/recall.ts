import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import type { RecallResult } from '../types';

const PMEM_DIR = '.pmem';

export function recallCommand(budget: number = 2000): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // Read hot memory: index, state, next
  const indexContent = readFile(path.join(pmemPath, 'index.md'));
  const stateContent = readFile(path.join(pmemPath, 'state.md'));
  const nextContent = readFile(path.join(pmemPath, 'next.md'));

  if (!indexContent) {
    console.log('No .pmem/index.md found. Run `pmem init` first.');
    return;
  }

  // Parse project info from index
  const projectName = extractField(indexContent, 'Name:');
  const projectStage = extractField(indexContent, 'Stage:');
  const currentFocus = extractField(indexContent, 'Current Focus');

  // Parse state
  const stateLines: string[] = [];
  if (stateContent) {
    const lines = stateContent.split('\n');
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith('## ')) {
        inSection = !line.includes('Overall Status');
      } else if (inSection && line.trim().startsWith('-')) {
        stateLines.push(line.trim());
      }
    }
  }

  // Parse next step
  const nextStep = nextContent
    ? extractField(nextContent, '## Recommended Next Step')
    : 'No next step recorded.';

  // Build output based on budget
  let output = '';

  // Budget 800+: always show project identity + focus + next
  output += `Project: ${projectName || 'Unknown'}\n`;
  if (projectStage) output += `Stage: ${projectStage}\n`;
  output += `\nCurrent Focus:\n${currentFocus || 'No focus recorded.'}\n`;
  output += `\nNext:\n${nextStep}\n`;

  if (stateLines.length > 0) {
    output += `\nCurrent State:\n${stateLines.join('\n')}\n`;
  }

  // Budget 2000+: add module list, must-read suggestions
  if (budget >= 2000) {
    const moduleFiles = listMdFiles(path.join(pmemPath, 'modules'));
    const featureFiles = listMdFiles(path.join(pmemPath, 'features'));
    const decisionFiles = listMdFiles(path.join(pmemPath, 'decisions'));

    if (moduleFiles.length > 0 || featureFiles.length > 0) {
      output += '\nModules:\n';
      for (const f of [...moduleFiles, ...featureFiles]) {
        const name = path.basename(f, '.md');
        output += `  - ${name}\n`;
      }
    }
    if (decisionFiles.length > 0) {
      output += '\nRecent Decisions:\n';
      for (const f of decisionFiles.slice(-5)) {
        const name = path.basename(f, '.md');
        output += `  - ${name}\n`;
      }
    }
    output += '\nMust Read:\n';
    output += '  - .pmem/state.md\n';
    output += '  - .pmem/next.md\n';
    for (const f of moduleFiles.slice(0, 3)) {
      output += `  - ${path.relative(cwd, f)}\n`;
    }
  }

  // Budget 5000+: full card content for top modules (truncated for now)
  if (budget >= 5000) {
    output += '\n---\n';
    output += '(Extended recall with full card content — reserved for v0.2)\n';
  }

  console.log(output.trim());
  console.log(`\n[Recall budget: ${budget} tokens (approximate)]`);
}

function extractField(content: string, fieldName: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(fieldName)) {
      const val = line.split(fieldName)[1]?.trim();
      if (val) return val;
      // Next line (for "## Current Focus" style)
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        return lines[i + 1].trim();
      }
    }
  }
  return null;
}

function listMdFiles(dir: string): string[] {
  if (!fileExists(dir)) return [];
  const fs = require('fs');
  return fs.readdirSync(dir)
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => path.join(dir, f));
}
