import * as path from 'path';
import * as fs from 'fs';
import { loadManifest } from '../core/manifest';
import { atomicWrite, readFile, fileExists } from '../core/fs';
import { parseFrontmatter } from '../core/yaml';
import { rebuildCommand } from './rebuild';

const PMEM_DIR = '.pmem';

// v0.6.4 polish 8: list-style frontmatter fields scanned in --dry-run mode.
// --write mode does NOT modify these (v0.6.2 safety semantics preserved).
const FRONTMATTER_LIST_FIELDS = ['aliases', 'tags', 'related', 'depends_on'] as const;

interface FrontmatterHit {
  field: string;
  index: number;
  oldValue: string;
  newValue: string;
}

interface Change {
  file: string;
  bodyCount: number;
  oldBody: string;
  newBody: string;
  fmEndIndex: number;
  frontmatterHits: FrontmatterHit[];
  bodyChanged: boolean;
}

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
  const changes: Change[] = [];
  let totalOccurrences = 0;

  for (const filePath of cardFiles) {
    const content = readFile(filePath);
    if (!content) continue;

    const { body, fmEndIndex } = splitFrontmatter(content);
    if (body === null) continue; // No valid frontmatter, skip

    const newBody = body.split(findPattern).join(replaceText);
    const bodyChanged = newBody !== body;

    // v0.6.4 polish 8: scan list-style frontmatter fields (dry-run only).
    // These are reported as hits regardless of body changes, so users
    // see the full rename picture before deciding to manually edit
    // frontmatter (since --write never touches frontmatter).
    const frontmatterHits = collectFrontmatterHits(content, findPattern, replaceText);

    if (bodyChanged) {
      const occurrences = (body.match(new RegExp(escapeRegExp(findPattern), 'g')) || []).length;
      totalOccurrences += occurrences;
      const relPath = path.relative(cwd, filePath);
      changes.push({
        file: relPath,
        bodyCount: occurrences,
        oldBody: body,
        newBody,
        fmEndIndex,
        frontmatterHits,
        bodyChanged: true,
      });
    } else if (frontmatterHits.length > 0) {
      // Body unchanged, but frontmatter has hits — still report the file in dry-run
      // so users know they need to manually edit those fields.
      const relPath = path.relative(cwd, filePath);
      changes.push({
        file: relPath,
        bodyCount: 0,
        oldBody: body,
        newBody: body,
        fmEndIndex,
        frontmatterHits,
        bodyChanged: false,
      });
    }
  }

  if (changes.length === 0) {
    console.log(`No matches found for "${findPattern}" in card bodies or frontmatter.`);
    return;
  }

  // Preview mode (default)
  if (!isWrite) {
    const totalFmHits = changes.reduce((sum, c) => sum + c.frontmatterHits.length, 0);
    const bodyOnlyCount = changes.filter(c => c.bodyChanged).length;
    if (totalFmHits > 0) {
      console.log(`Preview: ${bodyOnlyCount} file(s) would have body changed, ${totalOccurrences} body occurrence(s) would be replaced.`);
      console.log(`Plus ${totalFmHits} frontmatter hit(s) across ${changes.length} file(s) (preview only; --write does NOT modify frontmatter).\n`);
    } else {
      console.log(`Preview: ${bodyOnlyCount} file(s) would be changed, ${totalOccurrences} occurrence(s) would be replaced.\n`);
    }
    for (const change of changes) {
      const label = change.bodyChanged
        ? `${change.file} (${change.bodyCount} body occurrence(s))`
        : `${change.file} (no body change; frontmatter only)`;
      console.log(`--- ${label}`);
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
      // v0.6.4 polish 8: frontmatter diff preview
      if (change.frontmatterHits.length > 0) {
        console.log('  Frontmatter hits (preview only; --write does NOT modify frontmatter):');
        for (const hit of change.frontmatterHits) {
          console.log(`    Frontmatter.${hit.field}: ${hit.field} #${hit.index} "${hit.oldValue}" -> "${hit.newValue}"`);
        }
      }
      console.log('');
    }
    console.log('Add --write to apply these changes.');
    return;
  }

  // Write mode
  for (const change of changes) {
    if (!change.bodyChanged) continue; // Only frontmatter hits — --write does not touch frontmatter.
    const absPath = path.join(cwd, change.file);
    const content = readFile(absPath);
    if (!content) continue;

    // Re-validate frontmatter; use freshly-parsed fmEndIndex to reconstruct.
    // (This protects against concurrent edits between pass 1 and pass 2.)
    const { fmEndIndex } = splitFrontmatter(content);
    if (fmEndIndex === 0) continue; // No valid frontmatter now, skip

    // v0.6.4 polish 1: preserve original body whitespace exactly.
    // The newBody already contains the original frontmatter-end to body-start bytes
    // (whatever they were: \n\n, single \n, or none), because splitFrontmatter no
    // longer calls .trimStart(). So we reconstruct without inserting any separator.
    const newContent = content.substring(0, fmEndIndex) + change.newBody;
    atomicWrite(absPath, newContent);
  }

  console.log(`${changes.filter(c => c.bodyChanged).length} file(s) changed, ${totalOccurrences} occurrence(s) replaced.`);
  console.log('Rebuilding indexes...');
  rebuildCommand({ changed: true });
  console.log('Done. Run `pmem verify` to check consistency.');
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string | null; fmEndIndex: number } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: null, body: null, fmEndIndex: 0 };
  const fmEndIndex = match.index! + match[0].length;
  // v0.6.4 polish 1: preserve original body bytes — do NOT trim leading whitespace.
  // The body string is exactly content.substring(fmEndIndex) so the
  // frontmatter-to-body separator (typically "\n\n", but may be anything) is kept
  // byte-for-byte and can be reconstructed on write.
  const body = content.substring(fmEndIndex);
  return { frontmatter: match[1], body, fmEndIndex };
}

// v0.6.4 polish 8: scan list-style frontmatter fields for find/replace hits.
// Used only for --dry-run output. --write mode never modifies frontmatter.
function collectFrontmatterHits(
  content: string,
  findPattern: string,
  replaceText: string
): FrontmatterHit[] {
  const fm = parseFrontmatter(content);
  if (!fm) return [];
  const hits: FrontmatterHit[] = [];
  for (const field of FRONTMATTER_LIST_FIELDS) {
    const arr = fm.data[field];
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (typeof item === 'string' && item.includes(findPattern)) {
          const newItem = item.split(findPattern).join(replaceText);
          hits.push({ field, index: i, oldValue: item, newValue: newItem });
        }
      }
    }
  }
  return hits;
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
