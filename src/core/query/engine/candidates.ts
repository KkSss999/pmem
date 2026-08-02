import type Database from 'better-sqlite3';
import { ftsTableExists } from '../../db';
import type { CardRow, EdgeRow } from '../../../types';
import type { ParsedIntent } from './intent';
import { CHANNEL_BASE, ftsBase, graphBase, type ScoredCandidate } from './scoring';

export interface CandidateOptions {
  /** Max hops for graph expansion (default 1) */
  maxHops?: number;
  /** How many top seeds to expand (default 8) */
  expandTopN?: number;
  /** Optional candidates produced by the async semantic channel before graph expansion. */
  additionalCandidates?: readonly ScoredCandidate[];
}

export function generateCandidates(
  db: Database.Database,
  intent: ParsedIntent,
  opts: CandidateOptions = {}
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];

  collectIdMatches(db, intent, out);
  collectTitleMatches(db, intent, out);
  collectAliasMatches(db, intent, out);
  collectTagMatches(db, intent, out);
  collectSourceFileMatches(db, intent, out);
  collectFtsMatches(db, intent, out);

  if (opts.additionalCandidates) out.push(...opts.additionalCandidates);

  if (out.length === 0) {
    collectLikeMatches(db, intent, out);
  }

  expandGraph(db, out, opts);
  return out;
}

function push(out: ScoredCandidate[], card: CardRow, channel: keyof typeof CHANNEL_BASE, detail: string, base?: number, extra?: Partial<ScoredCandidate>): void {
  out.push({
    card,
    base: base ?? CHANNEL_BASE[channel],
    reasons: [{ channel, detail, base: base ?? CHANNEL_BASE[channel] }],
    graph_distance: 0,
    ...extra,
  });
}

/** Title-based matching: exact title, phrase, and per-token matching.
 *  Provides strong signals that rank above pure FTS body hits — critical
 *  for queries like "hybrid recall" where the user intends to find cards
 *  whose title contains those terms. */
function collectTitleMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const q = intent.normalized;

  // 1. Exact title match (case-insensitive)
  const exactRows = db.prepare(
    'SELECT * FROM cards WHERE LOWER(title) = ? AND is_deleted = 0'
  ).all(q) as CardRow[];
  for (const card of exactRows) {
    push(out, card, 'exact_title', `title = "${q}"`);
  }

  // 2. Title phrase match: full normalized query as substring of title
  if (q.length >= 2) {
    const phraseRows = db.prepare(
      'SELECT * FROM cards WHERE LOWER(title) LIKE ? AND is_deleted = 0'
    ).all(`%${q}%`) as CardRow[];
    for (const card of phraseRows) {
      // Don't double-count exact title matches
      if (card.title.toLowerCase() === q) continue;
      push(out, card, 'title_phrase', `title ~ "${q}"`);
    }
  }

  // 3. Per-token title hits: each query token found in the title
  const titleTokens = intent.tokens.filter(t => t.length >= 2 || /[一-鿿]/.test(t));
  for (const token of titleTokens) {
    // Skip the full query token to avoid redundant LIKE matches
    if (token === q) continue;
    const rows = db.prepare(
      'SELECT * FROM cards WHERE LOWER(title) LIKE ? AND is_deleted = 0'
    ).all(`%${token}%`) as CardRow[];
    for (const card of rows) {
      push(out, card, 'title_token', `title contains "${token}"`);
    }
  }
}

function collectIdMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const q = intent.normalized;
  const rows = db.prepare(
    'SELECT * FROM cards WHERE (id = ? OR id LIKE ?) AND is_deleted = 0'
  ).all(q, `%${q}%`) as CardRow[];
  for (const card of rows) {
    if (card.id === q) push(out, card, 'exact_id', `id = ${q}`);
    else push(out, card, 'id_substring', `id contains "${q}"`);
  }
  for (const idCand of intent.cardIdCandidates) {
    if (idCand === q) continue;
    const row = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(idCand) as CardRow | undefined;
    if (row) push(out, row, 'exact_id', `id token = ${idCand}`);
  }
}

function collectAliasMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const q = intent.normalized;
  const rows = db.prepare(
    `SELECT c.*, a.normalized_alias AS matched_alias FROM cards c
     JOIN aliases a ON c.id = a.card_id
     WHERE (a.normalized_alias = ? OR a.normalized_alias LIKE ?) AND c.is_deleted = 0`
  ).all(q, `%${q}%`) as Array<CardRow & { matched_alias: string }>;
  for (const row of rows) {
    push(out, row, 'alias', `alias: ${row.matched_alias}`);
  }
}

function collectTagMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const q = intent.normalized;
  const exact = db.prepare(
    `SELECT c.*, t.normalized_tag AS matched_tag FROM cards c
     JOIN tags t ON c.id = t.card_id
     WHERE t.normalized_tag = ? AND c.is_deleted = 0`
  ).all(q) as Array<CardRow & { matched_tag: string }>;
  for (const row of exact) push(out, row, 'tag', `tag: ${row.matched_tag}`);

  for (const token of intent.tokens) {
    if (token.length < 2 && !/[一-鿿]/.test(token)) continue;
    const rows = db.prepare(
      `SELECT c.*, t.normalized_tag AS matched_tag FROM cards c
       JOIN tags t ON c.id = t.card_id
       WHERE t.normalized_tag LIKE ? AND c.is_deleted = 0`
    ).all(`%${token}%`) as Array<CardRow & { matched_tag: string }>;
    for (const row of rows) push(out, row, 'tag_token', `tag ~ ${token} (${row.matched_tag})`);
  }
}

function collectSourceFileMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const candidates = intent.pathCandidates.length > 0
    ? intent.pathCandidates
    : (looksLikePath(intent.normalized) ? [intent.normalized] : []);

  for (const p of candidates) {
    const exact = db.prepare(
      `SELECT c.*, p.path AS matched_path FROM cards c
       JOIN paths p ON c.id = p.card_id
       WHERE p.path = ? AND c.is_deleted = 0`
    ).all(p) as Array<CardRow & { matched_path: string }>;
    for (const row of exact) push(out, row, 'source_file', `source file: ${row.matched_path}`);

    if (exact.length === 0) {
      const partial = db.prepare(
        `SELECT c.*, p.path AS matched_path FROM cards c
         JOIN paths p ON c.id = p.card_id
         WHERE p.path LIKE ? AND c.is_deleted = 0`
      ).all(`%${p}%`) as Array<CardRow & { matched_path: string }>;
      for (const row of partial) push(out, row, 'source_file_prefix', `source file ~ ${p} (${row.matched_path})`);
    }
  }
}

function looksLikePath(s: string): boolean {
  return !s.includes(' ') && (s.includes('/') || /\.[a-z]{1,4}$/.test(s));
}

function collectFtsMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  if (!ftsTableExists(db)) return;
  const ftsQuery = buildFtsQuery(intent);
  if (!ftsQuery) return;
  try {
    const rows = db.prepare(
      `SELECT c.*, bm25(card_fts, 0.0, 4.0, 2.0, 1.0, 3.0, 2.5) AS rank
       FROM card_fts JOIN cards c ON card_fts.card_id = c.id
       WHERE card_fts MATCH ? AND c.is_deleted = 0
       ORDER BY rank LIMIT 20`
    ).all(ftsQuery) as Array<CardRow & { rank: number }>;
    if (rows.length === 0) return;
    const best = rows[0].rank;
    const worst = rows[rows.length - 1].rank;
    for (const row of rows) {
      push(out, row, 'fts', `bm25 rank ${row.rank.toFixed(2)}`, ftsBase(row.rank, best, worst));
    }
  } catch {
    // Malformed FTS query (special chars) — skip channel silently
  }
}

function buildFtsQuery(intent: ParsedIntent): string | null {
  const terms = intent.tokens
    .filter(t => t.length >= 2 && /^[\w一-鿿-]+$/.test(t))
    .map(t => `"${t}"`);
  if (terms.length === 0) return null;
  return terms.join(' OR ');
}

function collectLikeMatches(db: Database.Database, intent: ParsedIntent, out: ScoredCandidate[]): void {
  const pattern = `%${intent.normalized}%`;
  const rows = db.prepare(
    'SELECT * FROM cards WHERE (title LIKE ? OR summary LIKE ?) AND is_deleted = 0'
  ).all(pattern, pattern) as CardRow[];
  for (const card of rows) {
    const titleLower = card.title.toLowerCase();
    const overlap = intent.tokens.filter(t => titleLower.includes(t)).length;
    const base = Math.min(CHANNEL_BASE.like, overlap / Math.max(1, intent.tokens.length));
    push(out, card, 'like', `title/summary contains "${intent.normalized}"`, Math.max(0.2, base));
  }
}

function expandGraph(db: Database.Database, out: ScoredCandidate[], opts: CandidateOptions): void {
  const maxHops = opts.maxHops ?? 1;
  const expandTopN = opts.expandTopN ?? 8;
  if (maxHops < 1 || out.length === 0) return;

  const seen = new Set(out.map(c => c.card.id));
  const seeds = [...out]
    .sort((a, b) => (b.base - a.base) || a.card.id.localeCompare(b.card.id))
    .slice(0, expandTopN);

  let frontier = seeds.map(s => ({
    id: s.card.id,
    score: s.base,
    seedEvidence: s.reasons.some(reason => reason.channel !== 'semantic' && reason.channel !== 'graph') ? 'lexical' as const : 'semantic' as const,
  }));

  for (let hop = 1; hop <= maxHops; hop++) {
    const nextFrontier: Array<{ id: string; score: number; seedEvidence: 'lexical' | 'semantic' }> = [];
    for (const node of frontier) {
      const edges = db.prepare(
        'SELECT * FROM edges WHERE from_id = ? OR to_id = ?'
      ).all(node.id, node.id) as EdgeRow[];
      for (const edge of edges) {
        const neighborId = edge.from_id === node.id ? edge.to_id : edge.from_id;
        const graphEvidence = {
          seed_card_id: node.id,
          edge_type: edge.type,
          distance: hop,
          seed_evidence: node.seedEvidence,
        } as const;
        if (seen.has(neighborId)) {
          // Semantic search may have found the same card first. Preserve the
          // actual edge as internal evidence without changing public graph
          // provenance or inventing a relation type.
          const existing = out.find(candidate => candidate.card.id === neighborId);
          if (existing && (!existing.graph_evidence
            || (existing.graph_evidence.seed_evidence === 'semantic' && node.seedEvidence === 'lexical')
            || graphEvidence.distance < existing.graph_evidence.distance)) {
            existing.graph_evidence = graphEvidence;
          }
          continue;
        }
        const neighbor = db.prepare(
          'SELECT * FROM cards WHERE id = ? AND is_deleted = 0'
        ).get(neighborId) as CardRow | undefined;
        if (!neighbor) continue;
        seen.add(neighborId);
        const base = graphBase(node.score, edge.confidence ?? 1.0, hop);
        out.push({
          card: neighbor,
          base,
          reasons: [{ channel: 'graph', detail: `${edge.type} ← ${node.id} (hop ${hop})`, base }],
          graph_distance: hop,
          edge_type: edge.type,
          from_card: node.id,
          graph_evidence: graphEvidence,
        });
        nextFrontier.push({ id: neighborId, score: base, seedEvidence: node.seedEvidence });
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }
}
