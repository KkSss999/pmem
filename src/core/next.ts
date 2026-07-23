import * as path from 'path';
import { fileExists, readFile, writeFile } from './fs';

export interface NextState {
  nextStep: string;
  why?: string;
  context?: string[];
}

export interface StructuredNextItem {
  step: string;
  priority?: 'P0' | 'P1' | 'P2';
  owner?: string;
  criteria: string[];
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

/**
 * v0.7.6 fix U3: writeManagedNext now supports partial writes.
 *
 * - Pass only the fields you want to change; other fields are preserved
 *   from the current `next.md` (if it exists). This is the default
 *   (merge) behavior and protects manually-curated `## Why` and
 *   `## Needed Context` sections from being clobbered by routine calls.
 * - Set `replaceManaged: true` to fully replace the managed block
 *   (legacy behavior — wipes prior `## Why` and `## Needed Context`).
 * - Calling with a plain `NextState` object (no `replaceManaged` key)
 *   is treated as a full replacement for backward compatibility.
 *
 * Returns the merged `NextState` that was persisted.
 */
export interface WriteNextOptions {
  nextStep?: string;
  why?: string;
  context?: string[];
  /** When true, fully replace the managed block (legacy behavior). Default false. */
  replaceManaged?: boolean;
}

export function writeManagedNext(pmemPath: string, opts: WriteNextOptions | NextState): NextState {
  const nextPath = path.join(pmemPath, 'next.md');
  const managedStart = '<!-- pmem:next:start -->';
  const managedEnd = '<!-- pmem:next:end -->';

  // Partial merge by default (v0.7.6 fix U3): protects manually-curated
  // ## Why / ## Needed Context from being clobbered by routine writes.
  // Callers that want the legacy full-replace behavior must pass
  // `replaceManaged: true` explicitly.
  const replaceManaged = (opts as WriteNextOptions).replaceManaged === true;

  let nextStep: string;
  let why: string | undefined;
  let context: string[] | undefined;

  if (replaceManaged) {
    nextStep = (opts as NextState).nextStep ?? '';
    why = (opts as NextState).why;
    context = (opts as NextState).context;
  } else {
    const prior: NextState = readNext(pmemPath);
    const o = opts as WriteNextOptions;
    nextStep = o.nextStep ?? prior.nextStep;
    why = o.why ?? prior.why;
    context = o.context ?? prior.context;
  }

  // If `nextStep` was never set (no prior, no override), default to empty.
  if (nextStep === undefined) {
    nextStep = '';
  }

  const merged: NextState = {
    nextStep,
    why: why || undefined,
    context: context && context.length > 0 ? context : undefined,
  };

  const contextBlock = merged.context && merged.context.length > 0
    ? `\n\n## Needed Context\n${merged.context.map(c => `- ${c}`).join('\n')}`
    : '';

  const whyBlock = merged.why
    ? `\n\n## Why\n${merged.why}`
    : '';

  const managedContent = `${managedStart}
## Recommended Next Step
${merged.nextStep}${whyBlock}${contextBlock}
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

  return merged;
}

/**
 * Parse structured task queue items from next.md content.
 *
 * Extracts priority tags ([P0]/[P1]/[P2]), owner mentions (@username),
 * and acceptance criteria (sub-bullets) from the "Recommended Next Step"
 * section of the managed block.
 *
 * Returns an empty array if no next steps are found. Backward compatible
 * with plain-text next steps (no structured format).
 */
export function parseStructuredNext(content: string): StructuredNextItem[] {
  const items: StructuredNextItem[] = [];

  const managedStart = '<!-- pmem:next:start -->';
  const managedEnd = '<!-- pmem:next:end -->';

  let block = '';
  const startIdx = content.indexOf(managedStart);
  const endIdx = content.indexOf(managedEnd);

  if (startIdx >= 0 && endIdx > startIdx) {
    block = content.substring(startIdx + managedStart.length, endIdx).trim();
  } else {
    block = content;
  }

  const lines = block.split('\n');
  let inNextStep = false;
  let currentItem: StructuredNextItem | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      if (inNextStep && currentItem) items.push(currentItem);
      currentItem = null;
      inNextStep = trimmed.toLowerCase().includes('recommended next step');
      continue;
    }

    if (!inNextStep) continue;
    if (!trimmed) continue;

    const leadingSpaces = (line.match(/^(\s*)/)?.[1]?.length ?? 0);
    const bulletMatch = trimmed.match(/^([-*]\s+|(\d+)[.)]\s+)/);

    if (bulletMatch) {
      if (leadingSpaces === 0) {
        if (currentItem) items.push(currentItem);

        const stepText = trimmed.substring(bulletMatch[0].length).trim();

        let priority: 'P0' | 'P1' | 'P2' | undefined;
        const priorityMatch = stepText.match(/\[P([012])\]/i);
        if (priorityMatch) {
          priority = `P${priorityMatch[1]}` as 'P0' | 'P1' | 'P2';
        }

        let owner: string | undefined;
        const ownerMatch = stepText.match(/@([\w][\w.-]*)/);
        if (ownerMatch) {
          owner = ownerMatch[1];
        }

        let cleanStep = stepText;
        if (priorityMatch) cleanStep = cleanStep.replace(priorityMatch[0], '').trim();
        if (ownerMatch) cleanStep = cleanStep.replace(ownerMatch[0], '').trim();

        currentItem = { step: cleanStep, priority, owner, criteria: [] };
      } else if (leadingSpaces >= 2 && currentItem) {
        const criteriaText = trimmed.substring(bulletMatch[0].length).trim();
        if (criteriaText) {
          currentItem.criteria.push(criteriaText);
        }
      }
    } else {
      if (currentItem) items.push(currentItem);
      currentItem = { step: trimmed, criteria: [] };
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
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
