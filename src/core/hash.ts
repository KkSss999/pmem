import { createHash } from 'crypto';

export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

export interface CardHashes {
  fileHash: string;
  frontmatterHash: string;
  bodyHash: string;
}

export function computeCardHashes(fullContent: string, frontmatterText: string, bodyText: string): CardHashes {
  return {
    fileHash: computeHash(fullContent),
    frontmatterHash: computeHash(frontmatterText),
    bodyHash: computeHash(bodyText),
  };
}

export function tokenCount(text: string): number {
  // Rough token estimation: ~4 chars per token for mixed zh/en text
  return Math.ceil(text.replace(/\s+/g, ' ').length / 4);
}

export function sectionCount(body: string): number {
  return (body.match(/^## /gm) || []).length;
}
