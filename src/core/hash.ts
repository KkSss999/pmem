import { createHash } from 'crypto';

export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}

export interface CardHashes {
  fileHash: string;
  frontmatterHash: string;
  bodyHash: string;
}

/**
 * Frontmatter keys maintained by pmem itself. They describe provenance and
 * runtime bookkeeping, not the user's memory payload, so they are excluded
 * from card size estimates. User-authored frontmatter (for example tags,
 * aliases, or a contract) remains part of the estimate.
 */
export const PMEM_MANAGED_FRONTMATTER_KEYS = new Set([
  'id',
  'type',
  'schema_version',
  'version',
  'created',
  'updated',
  'last_verified',
  'classification',
  'trust_label',
  'sensitivity',
  'token_policy',
]);

/** Remove pmem-managed top-level YAML fields while preserving user content. */
export function stripManagedFrontmatter(text: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return text;

  const lines = match[1].split(/\r?\n/);
  const retained: string[] = [];
  let skippingManagedBlock = false;
  for (const line of lines) {
    const topLevelField = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (topLevelField) {
      const managed = PMEM_MANAGED_FRONTMATTER_KEYS.has(topLevelField[1]);
      skippingManagedBlock = managed;
      if (!managed) retained.push(line);
      continue;
    }
    if (!skippingManagedBlock) retained.push(line);
  }

  const userFrontmatter = retained.join('\n').trim();
  const body = text.slice(match[0].length);
  return userFrontmatter ? `${userFrontmatter}\n${body}` : body;
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
  const userContent = stripManagedFrontmatter(text);
  return Math.ceil(userContent.replace(/\s+/g, ' ').length / 4);
}

export function sectionCount(body: string): number {
  return (body.match(/^## /gm) || []).length;
}
