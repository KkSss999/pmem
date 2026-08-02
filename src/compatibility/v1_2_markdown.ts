/** v1.2 Card Markdown importer. Kept outside the generic projection layer. */
import * as fs from 'node:fs';
import * as yaml from 'js-yaml';
import { v12CardToRecord } from './v1_2';
import type { MemoryRecord } from '../runtime/model';

export class LegacyCardImporter {
  import(filePath: string): MemoryRecord {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!match) throw new Error('Legacy Card Markdown is missing YAML frontmatter delimiters.');
    const frontmatter = yaml.load(match[1]);
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      throw new Error('Legacy Card Markdown frontmatter must be an object.');
    }
    return v12CardToRecord({ frontmatter, body: match[2], filePath });
  }
}

export function importLegacyCardMarkdown(filePath: string): MemoryRecord {
  return new LegacyCardImporter().import(filePath);
}
