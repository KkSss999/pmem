import * as path from 'path';
import { loadManifest } from '../core/manifest';
import { readFile, atomicWrite, listFiles, fileExists } from '../core/fs';
import { CardFrontmatter, MemoryCard, DistillConfig } from '../types';

const PMEM_DIR = '.pmem';

interface TraceGroup {
  relatedNode: string;
  traces: MemoryCard[];
  suggestedUpdate: string;
}

interface SplitSuggestion {
  cardId: string;
  cardFile: string;
  currentTokens: number;
  maxTokens: number;
  suggestedSplits: string[];
}

export function distillCommand(options: { confirm?: boolean; suggestSplits?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const manifest = loadManifest(pmemPath);

  if (!manifest) {
    console.log('No .pmem/manifest.yml found. Run `pmem init` first.');
    return;
  }

  if (options.suggestSplits) {
    suggestCardSplits(pmemPath, manifest);
    return;
  }

  const traceFiles = listFiles(path.join(pmemPath, 'traces'), /\.md$/);
  if (traceFiles.length === 0) {
    console.log('No trace files found to distill.');
    return;
  }

  // Parse all traces
  const traces: MemoryCard[] = [];
  for (const file of traceFiles) {
    const card = parseCard(file);
    if (card && !isDistilled(card.frontmatter)) {
      traces.push(card);
    }
  }

  const undistilledCount = traces.length;
  if (undistilledCount === 0) {
    console.log('All traces are already distilled.');
    return;
  }

  // Group by related node
  const groups = groupTracesByRelated(traces);

  console.log(`Found ${undistilledCount} undistilled trace(s) in ${groups.length} group(s).\n`);

  if (options.confirm) {
    applyDistillation(pmemPath, groups);
    // Mark traces as distilled
    markTracesDistilled(traceFiles, traces);
  } else {
    // Dry-run: show suggestions
    for (const group of groups) {
      console.log(`## Target: ${group.relatedNode}`);
      console.log(`  Traces: ${group.traces.length}`);
      console.log(`  Suggested update:`);
      console.log(`${group.suggestedUpdate.split('\n').map(l => '    ' + l).join('\n')}`);
      console.log('');
    }
    console.log('Run with --confirm to apply these changes.');
  }
}

function parseCard(filePath: string): MemoryCard | null {
  const content = readFile(filePath);
  if (!content) return null;
  return parseFrontmatterAndBody(content, filePath);
}

function parseFrontmatterAndBody(content: string, filePath: string): MemoryCard | null {
  if (!content.startsWith('---')) return null;
  const endIdx = content.indexOf('---', 4);
  if (endIdx < 0) return null;

  const fmText = content.substring(4, endIdx);
  const body = content.substring(endIdx + 3).trim();

  const frontmatter: CardFrontmatter = { id: '', type: 'trace' };
  for (const line of fmText.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)/);
    if (match) {
      const key = match[1];
      let val: any = match[2].trim();
      if (key === 'tags' && val.startsWith('[')) {
        val = val.slice(1, -1).split(',').map((s: string) => s.trim());
      }
      if (key === 'related' && val.startsWith('[')) {
        val = val.slice(1, -1).split(',').map((s: string) => s.trim());
      }
      (frontmatter as any)[key] = val;
    }
  }

  return { frontmatter, body, filePath };
}

function isDistilled(fm: CardFrontmatter): boolean {
  return (fm as any).distilled === true || (fm as any).distilled === 'true';
}

function groupTracesByRelated(traces: MemoryCard[]): TraceGroup[] {
  const map = new Map<string, MemoryCard[]>();

  for (const trace of traces) {
    const related = trace.frontmatter.related || [];
    const key = related.length > 0 ? related[0] : 'project';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(trace);
  }

  const groups: TraceGroup[] = [];
  for (const [node, nodeTraces] of map) {
    const summaryParts = nodeTraces.map(t => {
      const title = extractMarkdownTitle(t.body) || path.basename(t.filePath, '.md');
      return `- ${title}`;
    });
    groups.push({
      relatedNode: node,
      traces: nodeTraces,
      suggestedUpdate: `Add distilled insights from ${nodeTraces.length} trace(s):\n${summaryParts.join('\n')}`,
    });
  }

  return groups;
}

function extractMarkdownTitle(body: string): string | null {
  const match = body.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

function applyDistillation(pmemPath: string, groups: TraceGroup[]): void {
  for (const group of groups) {
    // Find the target card file
    const cardPath = findCardFile(pmemPath, group.relatedNode);
    if (!cardPath) {
      console.log(`  ⚠ Target card not found for ${group.relatedNode}, skipping.`);
      continue;
    }

    const content = readFile(cardPath);
    if (!content) continue;

    // Append distilled content to the card
    const distilledSection = `\n\n## Distilled from Traces (${new Date().toISOString().split('T')[0]})\n${group.suggestedUpdate.split('\n').map(l => '> ' + l.replace(/^- /, '• ')).join('\n')}\n`;
    const updated = content.trimEnd() + distilledSection;
    atomicWrite(cardPath, updated);
    console.log(`  ✓ Updated ${group.relatedNode} (${cardPath})`);
  }
}

function findCardFile(pmemPath: string, nodeId: string): string | null {
  // Search through modules/, features/, decisions/, tasks/
  for (const dir of ['modules', 'features', 'decisions', 'tasks']) {
    const dirPath = path.join(pmemPath, dir);
    if (!fileExists(dirPath)) continue;
    const files = listFiles(dirPath, /\.md$/);
    for (const file of files) {
      const content = readFile(file);
      if (content) {
        const fmMatch = content.match(/^id:\s*(.+)$/m);
        if (fmMatch && fmMatch[1].trim() === nodeId) {
          return file;
        }
      }
    }
  }
  return null;
}

function markTracesDistilled(allTraceFiles: string[], allTraces: MemoryCard[]): void {
  let marked = 0;
  for (const file of allTraceFiles) {
    const content = readFile(file);
    if (!content || !content.startsWith('---')) continue;

    // Check if this trace is in our undistilled set
    const isUndistilled = allTraces.some(t => t.filePath === file);
    if (!isUndistilled) continue;

    // Add distilled: true to frontmatter
    const endIdx = content.indexOf('---', 4);
    if (endIdx < 0) continue;

    const before = content.substring(0, endIdx);
    let fmText = content.substring(4, endIdx);
    const after = content.substring(endIdx);

    if (!fmText.includes('distilled:')) {
      fmText = fmText.trimEnd() + '\ndistilled: true';
      const updated = '---' + fmText + after;
      atomicWrite(file, updated);
      marked++;
    }
  }
  if (marked > 0) {
    console.log(`  ✓ Marked ${marked} trace(s) as distilled.`);
    console.log('  Run `pmem rebuild` to update indexes.');
  }
}

function suggestCardSplits(pmemPath: string, manifest: ReturnType<typeof loadManifest>): void {
  if (!manifest?.card_policy) {
    console.log('No card_policy defined in manifest.');
    return;
  }

  const policy = manifest.card_policy;
  const suggestions: SplitSuggestion[] = [];

  // Scan all cards
  const cardFiles = listFiles(pmemPath, /\.md$/);
  for (const file of cardFiles) {
    if (file.includes('/traces/') || file.includes('/backups/') || file.includes('/indexes/') || file.includes('/integrations/')) continue;

    const content = readFile(file);
    if (!content) continue;

    const estimatedTokens = Math.ceil(content.length / 4);
    const card = parseCard(file);
    if (!card) continue;

    const maxForType = policy.max_tokens[card.frontmatter.type];
    if (maxForType && estimatedTokens > maxForType) {
      // Count markdown sections
      const h2s = content.match(/^##\s+(.+)$/gm);
      const splitNames = h2s ? h2s.slice(0, 4).map(h => h.replace(/^##\s+/, '').trim()) : [];

      suggestions.push({
        cardId: card.frontmatter.id || path.basename(file, '.md'),
        cardFile: file,
        currentTokens: estimatedTokens,
        maxTokens: maxForType,
        suggestedSplits: splitNames.length > 0 ? splitNames : ['(No H2 sections to suggest splits from)'],
      });
    }
  }

  if (suggestions.length === 0) {
    console.log('No oversized cards detected.');
    return;
  }

  console.log('Card Split Suggestions:\n');
  for (const s of suggestions) {
    console.log(`## ${s.cardId}`);
    console.log(`  File: ${s.cardFile}`);
    console.log(`  Tokens: ~${s.currentTokens} / max ${s.maxTokens}`);
    console.log(`  Suggested splits:`);
    for (const split of s.suggestedSplits) {
      console.log(`    - ${s.cardId}.${toSlug(split)}`);
    }
    console.log('');
  }
  console.log('Review each card and split manually, or use a future `pmem split --interactive` command.');
}

function toSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
