import * as path from 'path';
import { fileExists } from '../fs';
import { openDatabase, createSchema, hasFTS5 } from '../db';
import { loadManifest, resolveConfig } from '../manifest';
import type { CardRow, EdgeRow } from '../../types';

type MatchType = 'exact_id' | 'exact_title' | 'alias' | 'tag' | 'graph_expansion' | 'keyword_fallback';

interface AskMatchV03 {
  id: string;
  title: string;
  match_type: MatchType;
  confidence: number;
  graph_distance: number;
  file: string;
  edge_type?: string;
  from_card?: string;
}

export interface AskResultV03 {
  query: string;
  matched: AskMatchV03[];
  recommended_files: string[];
  evidence_paths: string[];
}

export function askQuery(pmemPath: string, query: string): AskResultV03 {
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }

  const db = openDatabase(pmemPath);
  createSchema(db);

  const normalizedQuery = query.toLowerCase().trim();
  const queryTokens = tokenize(normalizedQuery);

  const matches: AskMatchV03[] = [];
  const seenIds = new Set<string>();

  // Step 1: Exact match — card ID
  const idMatches = db.prepare(
    "SELECT * FROM cards WHERE (id = ? OR id LIKE ?) AND is_deleted = 0"
  ).all(normalizedQuery, `%${normalizedQuery}%`) as CardRow[];

  for (const card of idMatches) {
    if (seenIds.has(card.id)) continue;
    seenIds.add(card.id);
    matches.push({
      id: card.id,
      title: card.title,
      match_type: card.id === normalizedQuery ? 'exact_id' : 'exact_title',
      confidence: card.id === normalizedQuery ? 0.95 : 0.85,
      graph_distance: 0,
      file: card.file_path,
    });
  }

  // Step 2: Exact match — aliases
  const aliasMatches = db.prepare(
    `SELECT c.* FROM cards c
     JOIN aliases a ON c.id = a.card_id
     WHERE (a.normalized_alias = ? OR a.normalized_alias LIKE ?)
       AND c.is_deleted = 0`
  ).all(normalizedQuery, `%${normalizedQuery}%`) as CardRow[];

  for (const card of aliasMatches) {
    if (seenIds.has(card.id)) continue;
    seenIds.add(card.id);
    matches.push({
      id: card.id,
      title: card.title,
      match_type: 'alias',
      confidence: 0.9,
      graph_distance: 0,
      file: card.file_path,
    });
  }

  // Step 3: Exact match — tags
  const tagMatches = db.prepare(
    `SELECT c.* FROM cards c
     JOIN tags t ON c.id = t.card_id
     WHERE t.normalized_tag = ?
       AND c.is_deleted = 0`
  ).all(normalizedQuery) as CardRow[];

  for (const card of tagMatches) {
    if (seenIds.has(card.id)) continue;
    seenIds.add(card.id);
    matches.push({
      id: card.id,
      title: card.title,
      match_type: 'tag',
      confidence: 0.7,
      graph_distance: 0,
      file: card.file_path,
    });
  }

  // Token-based tag matching
  for (const token of queryTokens) {
    const tokenTagMatches = db.prepare(
      `SELECT c.* FROM cards c
       JOIN tags t ON c.id = t.card_id
       WHERE t.normalized_tag LIKE ?
         AND c.is_deleted = 0`
    ).all(`%${token}%`) as CardRow[];

    for (const card of tokenTagMatches) {
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      matches.push({
        id: card.id,
        title: card.title,
        match_type: 'tag',
        confidence: 0.6,
        graph_distance: 0,
        file: card.file_path,
      });
    }
  }

  // Step 4: Graph expansion — 1-hop neighbors
  const matchedIdsAtThisPoint = new Set(matches.map(m => m.id));

  for (const match of matches) {
    const edges = db.prepare(
      "SELECT * FROM edges WHERE from_id = ? OR to_id = ?"
    ).all(match.id, match.id) as EdgeRow[];

    for (const edge of edges) {
      const neighborId = edge.from_id === match.id ? edge.to_id : edge.from_id;
      if (matchedIdsAtThisPoint.has(neighborId) || seenIds.has(neighborId)) continue;
      seenIds.add(neighborId);

      const neighborCard = db.prepare(
        "SELECT * FROM cards WHERE id = ? AND is_deleted = 0"
      ).get(neighborId) as CardRow | undefined;

      if (neighborCard) {
        matches.push({
          id: neighborCard.id,
          title: neighborCard.title,
          match_type: 'graph_expansion',
          confidence: 0.6,
          graph_distance: 1,
          file: neighborCard.file_path,
          edge_type: edge.type,
          from_card: match.id,
        });
      }
    }
  }

  // Step 5: Keyword fallback — FTS5 if available, else LIKE
  const directMatchesBeforeFallback = matches.filter(m => m.match_type !== 'graph_expansion');

  if (directMatchesBeforeFallback.length === 0) {
    if (hasFTS5(db)) {
      try {
        const ftsResults = db.prepare(
          "SELECT c.*, rank FROM card_fts JOIN cards c ON card_fts.card_id = c.id WHERE card_fts MATCH ? AND c.is_deleted = 0 ORDER BY rank"
        ).all(normalizedQuery) as Array<CardRow & { rank: number }>;

        for (const row of ftsResults) {
          if (seenIds.has(row.id)) continue;
          seenIds.add(row.id);
          matches.push({
            id: row.id,
            title: row.title,
            match_type: 'keyword_fallback',
            confidence: Math.min(0.5, 1 / (1 + (row.rank || 1))),
            graph_distance: 0,
            file: row.file_path,
          });
        }
      } catch {
        // FTS5 query failed, fall through to LIKE fallback
      }
    }

    // LIKE fallback
    if (matches.filter(m => m.match_type === 'keyword_fallback').length === 0) {
      const likePattern = `%${normalizedQuery}%`;
      const likeResults = db.prepare(
        "SELECT * FROM cards WHERE (title LIKE ? OR summary LIKE ?) AND is_deleted = 0"
      ).all(likePattern, likePattern) as CardRow[];

      for (const card of likeResults) {
        if (seenIds.has(card.id)) continue;
        seenIds.add(card.id);
        const titleLower = card.title.toLowerCase();
        const tokenOverlap = queryTokens.filter(t => titleLower.includes(t)).length;
        matches.push({
          id: card.id,
          title: card.title,
          match_type: 'keyword_fallback',
          confidence: Math.min(0.5, tokenOverlap / Math.max(1, queryTokens.length)),
          graph_distance: 0,
          file: card.file_path,
        });
      }
    }
  }

  // Step 6: Rerank
  const typeOrder: Record<MatchType, number> = {
    exact_id: 5,
    exact_title: 4,
    alias: 3,
    tag: 2,
    graph_expansion: 1,
    keyword_fallback: 0,
  };

  matches.sort((a, b) => {
    return (
      (typeOrder[b.match_type] - typeOrder[a.match_type]) ||
      (b.confidence - a.confidence) ||
      (a.graph_distance - b.graph_distance)
    );
  });

  // Step 7: Deduplicate
  const dedupedIds = new Set<string>();
  const deduped: AskMatchV03[] = [];
  for (const m of matches) {
    if (dedupedIds.has(m.id)) continue;
    dedupedIds.add(m.id);
    deduped.push(m);
  }

  // Build recommended_files and evidence_paths
  const recommendedFiles: string[] = [];
  for (const m of deduped.slice(0, 8)) {
    recommendedFiles.push(m.file);
  }

  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest) : { evidence_types: ['decision', 'trace'] };
  const evidenceTypes = config.evidence_types;

  const evidencePaths: string[] = [];
  for (const m of deduped) {
    const card = db.prepare(
      "SELECT type, file_path FROM cards WHERE id = ? AND is_deleted = 0"
    ).get(m.id) as { type: string; file_path: string } | undefined;
    if (card && evidenceTypes.includes(card.type)) {
      evidencePaths.push(card.file_path);
    }
  }

  return {
    query,
    matched: deduped,
    recommended_files: recommendedFiles,
    evidence_paths: evidencePaths,
  };
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const words = text.split(/[\s,，。、；;：:！!？?()（）\[\]【】{}]+/);
  for (const word of words) {
    if (word.length === 0) continue;
    if (/[一-鿿]/.test(word)) {
      const cjkChars = word.match(/[一-鿿]/g) || [];
      tokens.push(...cjkChars);
      const nonCjk = word.replace(/[一-鿿]/g, '').trim();
      if (nonCjk) tokens.push(nonCjk.toLowerCase());
    } else {
      tokens.push(word.toLowerCase());
    }
  }
  return [...new Set(tokens)];
}
