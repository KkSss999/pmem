import * as path from 'path';
import { fileExists, readFile, writeFile } from './fs';

export interface NextState {
  nextStep: string;
  why?: string;
  context?: string[];
}

export function readNext(pmemPath: string): NextState {
  const nextPath = path.join(pmemPath, 'next.md');
  if (!fileExists(nextPath)) {
    return { nextStep: 'No next step recorded.' };
  }

  const content = readFile(nextPath) || '';
  const managedStart = '<!-- pmem:next:start -->';
  const managedEnd = '<!-- pmem:next:end -->';

  const startIdx = content.indexOf(managedStart);
  const endIdx = content.indexOf(managedEnd);

  if (startIdx >= 0 && endIdx > startIdx) {
    const block = content.substring(startIdx + managedStart.length, endIdx).trim();
    let nextStep = '';
    let why = '';
    const context: string[] = [];

    const lines = block.split('\n');
    let currentField = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## Recommended Next Step')) {
        currentField = 'next';
      } else if (trimmed.startsWith('## Why')) {
        currentField = 'why';
      } else if (trimmed.startsWith('## Needed Context')) {
        currentField = 'context';
      } else if (trimmed.startsWith('## ')) {
        currentField = '';
      } else if (currentField === 'next') {
        if (trimmed) {
          nextStep = (nextStep + '\n' + trimmed).trim();
        }
      } else if (currentField === 'why') {
        if (trimmed) {
          why = (why + '\n' + trimmed).trim();
        }
      } else if (currentField === 'context') {
        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          context.push(trimmed.substring(1).trim());
        } else if (trimmed) {
          context.push(trimmed);
        }
      }
    }

    if (nextStep) {
      return { nextStep, why: why || undefined, context: context.length > 0 ? context : undefined };
    }
  }

  // Fallback to legacy extraction
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('## Recommended Next Step')) {
      const val = line.split('## Recommended Next Step')[1]?.trim();
      if (val) return { nextStep: val };
      if (i + 1 < lines.length && lines[i + 1].trim()) {
        return { nextStep: lines[i + 1].trim() };
      }
    }
  }

  return { nextStep: 'No next step recorded.' };
}

export function writeManagedNext(pmemPath: string, nextState: NextState): void {
  const nextPath = path.join(pmemPath, 'next.md');
  const managedStart = '<!-- pmem:next:start -->';
  const managedEnd = '<!-- pmem:next:end -->';

  const contextBlock = nextState.context && nextState.context.length > 0
    ? `\n\n## Needed Context\n${nextState.context.map(c => `- ${c}`).join('\n')}`
    : '';

  const whyBlock = nextState.why
    ? `\n\n## Why\n${nextState.why}`
    : '';

  const managedContent = `${managedStart}
## Recommended Next Step
${nextState.nextStep}${whyBlock}${contextBlock}
${managedEnd}`;

  let currentContent = '';
  if (fileExists(nextPath)) {
    currentContent = readFile(nextPath) || '';
  } else {
    currentContent = '# Next Steps\n\n';
  }

  const startIdx = currentContent.indexOf(managedStart);
  const endIdx = currentContent.indexOf(managedEnd);

  let updatedContent = '';
  if (startIdx >= 0 && endIdx > startIdx) {
    updatedContent = currentContent.substring(0, startIdx) +
      managedContent +
      currentContent.substring(endIdx + managedEnd.length);
  } else {
    const headingIndex = currentContent.indexOf('## Recommended Next Step');
    if (headingIndex >= 0) {
      updatedContent = currentContent.substring(0, headingIndex) + managedContent;
    } else {
      const spacer = currentContent.endsWith('\n') ? '' : '\n';
      updatedContent = `${currentContent}${spacer}\n${managedContent}\n`;
    }
  }

  // Write content, removing any duplicate outer headings if they somehow exist
  writeFile(nextPath, updatedContent.trim() + '\n');
}

export function migrateNextIfNeeded(pmemPath: string): void {
  const nextPath = path.join(pmemPath, 'next.md');
  if (!fileExists(nextPath)) return;

  const content = readFile(nextPath) || '';
  const managedStart = '<!-- pmem:next:start -->';

  if (content.indexOf(managedStart) < 0) {
    const state = readNext(pmemPath);
    writeManagedNext(pmemPath, state);
  }
}
