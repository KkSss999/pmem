import * as path from 'path';
import { createHash } from 'crypto';
import type { CardFrontmatter, CardRow } from '../../types';
import { closeDatabase, createSchema, openOwnedDatabase } from '../db';
import { readFile } from '../fs';
import { parseFrontmatter } from '../yaml';
import { clearSemanticIndex, getSemanticStatus, rebuildSemanticIndex } from './lifecycle';
import { isSemanticSafeCard } from './safety';
import type {
  EmbeddingProvider,
  SemanticCardDocument,
  SemanticIndexResult,
  SemanticProjectRebuildOptions,
  SemanticProjectStatus,
} from './types';

function parseSupersededBy(value: string | string[] | null | undefined): string[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : undefined;
  } catch {
    return [value];
  }
}

/** Load the complete current semantic source snapshot from indexed Markdown cards. */
export function loadSemanticProjectDocuments(pmemPath: string): SemanticCardDocument[] {
  const db = openOwnedDatabase(pmemPath);
  try {
    createSchema(db);
    const projectRoot = path.dirname(pmemPath);
    const rows = db.prepare('SELECT * FROM cards').all() as CardRow[];
    const aliasesQuery = db.prepare('SELECT alias FROM aliases WHERE card_id = ? ORDER BY normalized_alias');
    const tagsQuery = db.prepare('SELECT tag FROM tags WHERE card_id = ? ORDER BY normalized_tag');
    const pathsQuery = db.prepare('SELECT path FROM paths WHERE card_id = ? ORDER BY path');
    const relatedQuery = db.prepare(`
      SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS card_id
      FROM edges WHERE from_id = ? OR to_id = ? ORDER BY card_id
    `);
    const documents: SemanticCardDocument[] = [];
    for (const row of rows) {
      const raw = readFile(path.resolve(projectRoot, row.file_path));
      const parsed = raw ? parseFrontmatter(raw) : null;
      const frontmatter = (parsed?.data ?? {}) as Partial<CardFrontmatter>;
      documents.push({
        id: row.id,
        type: row.type,
        status: row.status,
        title: row.title,
        summary: row.summary,
        body: parsed?.body ?? '',
        aliases: (aliasesQuery.all(row.id) as Array<{ alias: string }>).map(item => item.alias),
        tags: (tagsQuery.all(row.id) as Array<{ tag: string }>).map(item => item.tag),
        sourceFiles: (pathsQuery.all(row.id) as Array<{ path: string }>).map(item => item.path),
        frontmatter: {
          trust_label: frontmatter.trust_label ?? row.trust_label as CardFrontmatter['trust_label'],
          sensitivity: frontmatter.sensitivity ?? row.sensitivity as CardFrontmatter['sensitivity'],
          superseded_by: frontmatter.superseded_by ?? parseSupersededBy(row.superseded_by),
        },
        isCandidate: row.is_candidate !== 0,
        isDeleted: row.is_deleted !== 0 || !raw,
      });
    }
    // Relationship labels are contextual embedding input too. Only expose
    // neighbors that independently pass the same source-level allowlist.
    const safeIds = new Set(documents.filter(isSemanticSafeCard).map(document => document.id));
    for (const document of documents) {
      document.relatedCardIds = (relatedQuery.all(document.id, document.id, document.id) as Array<{ card_id: string }>)
        .map(item => item.card_id)
        .filter(id => safeIds.has(id));
    }
    return documents;
  } finally {
    closeDatabase(db);
  }
}

export function getSemanticProjectStatus(pmemPath: string): SemanticProjectStatus {
  const db = openOwnedDatabase(pmemPath);
  try {
    createSchema(db);
    const status = getSemanticStatus(db);
    const count = db.prepare('SELECT COUNT(DISTINCT card_id) AS count FROM semantic_chunks').get() as { count: number };
    return { ...status, cardCount: count.count };
  } finally {
    closeDatabase(db);
  }
}

export async function rebuildSemanticProject(
  pmemPath: string,
  provider: EmbeddingProvider,
  options: SemanticProjectRebuildOptions,
): Promise<SemanticIndexResult> {
  const documents = loadSemanticProjectDocuments(pmemPath);
  const snapshotHash = semanticDocumentsHash(documents);
  const db = openOwnedDatabase(pmemPath);
  try {
    createSchema(db);
    return await rebuildSemanticIndex(db, documents, provider, {
      ...options,
      beforeCommit: () => {
        const currentHash = semanticDocumentsHash(loadSemanticProjectDocuments(pmemPath));
        if (currentHash !== snapshotHash) {
          throw new Error('Semantic source snapshot changed during rebuild; no index changes were committed. Re-run `pmem semantic rebuild`.');
        }
      },
    });
  } finally {
    closeDatabase(db);
  }
}

function semanticDocumentsHash(documents: readonly SemanticCardDocument[]): string {
  const canonical = [...documents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(document => JSON.stringify({
      id: document.id,
      type: document.type ?? null,
      status: document.status ?? null,
      title: document.title,
      summary: document.summary ?? null,
      body: document.body,
      aliases: document.aliases ?? [],
      tags: document.tags ?? [],
      sourceFiles: document.sourceFiles ?? [],
      relatedCardIds: document.relatedCardIds ?? [],
      frontmatter: document.frontmatter ?? null,
      isCandidate: document.isCandidate ?? false,
      isDeleted: document.isDeleted ?? false,
    }))
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function clearSemanticProject(pmemPath: string): number {
  const db = openOwnedDatabase(pmemPath);
  try {
    createSchema(db);
    return clearSemanticIndex(db);
  } finally {
    closeDatabase(db);
  }
}
