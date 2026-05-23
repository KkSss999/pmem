import * as path from 'path';
import * as fs from 'fs';
import { loadManifest } from '../core/manifest';
import { atomicWrite, readFile, fileExists } from '../core/fs';
import { rebuildCommand } from './rebuild';

const PMEM_DIR = '.pmem';

export function renameCommand(options: { find: string; replace: string; write?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const manifest = loadManifest(pmemPath);
  if (!manifest || !manifest.source_of_truth?.card_globs) {
    console.log('No valid manifest or card_globs found. Run `pmem rebuild` first.');
    return;
  }

  const cardGlobs: string[] = manifest.source_of_truth.card_globs;
  const findPattern = options.find;
  const replaceText = options.replace;
  const isWrite = options.write === true;

  // Reject empty --find pattern: splitting on empty string inserts between every character
  if (!findPattern || findPattern.length === 0) {
    console.log('Error: --find pattern must not be empty.');
    console.log('An empty pattern would insert the replacement between every character in card bodies.');
    process.exit(2);
  }

  // Collect all card files matching card_globs
  const cardFiles = new Set<string>();
  for (const cardGlob of cardGlobs) {
    // card_globs are patterns like ".pmem/modules/**/*.md"
    // Extract base directory by removing the /**/... suffix
    const globSuffixIndex = cardGlob.indexOf('/**/');
    const baseDir = globSuffixIndex >= 0
      ? path.join(cwd, cardGlob.substring(0, globSuffixIndex))
      : path.join(cwd, path.dirname(cardGlob));
    if (fs.existsSync(baseDir)) {
      collectMdFiles(baseDir, cardFiles);
    }
  }

  if (cardFiles.size === 0) {
    console.log('No memory card files found.');
    return;
  }

  // Process each card file
  const changes: Array<{ file: string; count: number; oldBody: string; newBody: string }> = [];
  let totalOccurrences = 0;

  for (const filePath of cardFiles) {
    const content = readFile(filePath);
    if (!content) continue;

    const { frontmatter, body } = splitFrontmatter(content);
    if (body === null) continue; // No valid frontmatter, skip

    const newBody = body.split(findPattern).join(replaceText);
    if (newBody !== body) {
      const occurrences = (body.match(new RegExp(escapeRegExp(findPattern), 'g')) || []).length;
      totalOccurrences += occurrences;
      const relPath = path.relative(cwd, filePath);
      changes.push({ file: relPath, count: occurrences, oldBody: body, newBody });
    }
  }

  if (changes.length === 0) {
    console.log(`No matches found for "${findPattern}" in card bodies.`);
    return;
  }

  // Preview mode (default)
  if (!isWrite) {
    console.log(`Preview: ${changes.length} file(s) would be changed, ${totalOccurrences} occurrence(s) would be replaced.\n`);
    for (const change of changes) {
      console.log(`--- ${change.file} (${change.count} occurrence(s))`);
      // Show first diff hunk
      const oldLines = change.oldBody.split('\n');
      const newLines = change.newBody.split('\n');
      const maxLines = Math.min(Math.max(oldLines.length, newLines.length), 10);
      for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i] ?? '';
        const newLine = newLines[i] ?? '';
        if (oldLine !== newLine) {
          if (oldLine) console.log(`- ${oldLine}`);
          if (newLine) console.log(`+ ${newLine}`);
        }
      }
      if (oldLines.length > 10 || newLines.length > 10) {
        console.log(`  ... (${Math.abs(oldLines.length - 10)} more lines)`);
      }
      console.log('');
    }
    console.log('Add --write to apply these changes.');
    return;
  }

  // Write mode
  for (const change of changes) {
    const absPath = path.join(cwd, change.file);
    const content = readFile(absPath);
    if (!content) continue;

    const { frontmatter } = splitFrontmatter(content);
    // Reconstruct: keep original frontmatter bytes exactly, replace body
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fmEnd = fmMatch.index! + fmMatch[0].length;
    // Preserve the original body structure exactly — only the find/replace text is changed,
    // no trimming or whitespace normalization.
    const newContent = content.substring(0, fmEnd) + '\n\n' + change.newBody + '\n';
    atomicWrite(absPath, newContent);
  }

  console.log(`${changes.length} file(s) changed, ${totalOccurrences} occurrence(s) replaced.`);
  console.log('Rebuilding indexes...');
  rebuildCommand({ changed: true });
  console.log('Done. Run `pmem verify` to check consistency.');
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string | null } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: null, body: null };
  const body = content.substring(match.index! + match[0].length).trimStart();
  return { frontmatter: match[1], body };
}

function collectMdFiles(dir: string, results: Set<string>): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMdFiles(fullPath, results);
    } else if (entry.name.endsWith('.md')) {
      results.add(fullPath);
    }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
