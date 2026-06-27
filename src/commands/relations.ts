import * as path from 'path';
import { fileExists } from '../core/fs';
import { openDatabase, createSchema } from '../core/db';

const PMEM_DIR = '.pmem';

export interface RelationsEdgeOut {
  edge_id: number;
  to_id: string;
  type: string;
  source: string;
  confidence: number;
}

export interface RelationsEdgeIn {
  edge_id: number;
  from_id: string;
  type: string;
  source: string;
  confidence: number;
}

export interface RelationsPruningCandidate {
  edge_id: number;
  direction: 'out' | 'in';
  other_id: string;
  type: string;
  source: string;
  confidence: number;
  reason: 'inferred' | 'low_confidence';
}

export interface RelationsQueryResult {
  card_id: string;
  outgoing: RelationsEdgeOut[];
  incoming: RelationsEdgeIn[];
  total: number;
  summary_by_type: Record<string, number>;
  summary_by_source: Record<string, number>;
  pruning_candidates: RelationsPruningCandidate[];
}

export interface RelationsQueryOptions {
  type?: string;
  source?: 'explicit' | 'inferred' | 'mention' | 'manual' | 'all';
  limit?: number;
}

export function relationsQuery(
  pmemPath: string,
  cardId: string,
  options?: RelationsQueryOptions
): RelationsQueryResult {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }
  const db = openDatabase(pmemPath);
  createSchema(db);

  // Verify card exists
  const card = db
    .prepare('SELECT id, title FROM cards WHERE id = ? AND is_deleted = 0')
    .get(cardId) as { id: string; title: string } | undefined;
  if (!card) {
    throw new Error(`Card "${cardId}" not found.`);
  }

  // Build filter clause
  const filters: string[] = [];
  const params: unknown[] = [];
  if (options?.type) {
    filters.push('type = ?');
    params.push(options.type);
  }
  if (options?.source && options.source !== 'all') {
    filters.push('source = ?');
    params.push(options.source);
  }
  const whereClause = filters.length > 0 ? ' AND ' + filters.join(' AND ') : '';

  const outgoingRows = db
    .prepare(
      `SELECT id as edge_id, to_id, type, source, confidence
       FROM edges
       WHERE from_id = ?${whereClause}
       ORDER BY confidence ASC, edge_id ASC`
    )
    .all(cardId, ...params) as RelationsEdgeOut[];

  const incomingRows = db
    .prepare(
      `SELECT id as edge_id, from_id, type, source, confidence
       FROM edges
       WHERE to_id = ?${whereClause}
       ORDER BY confidence ASC, edge_id ASC`
    )
    .all(cardId, ...params) as RelationsEdgeIn[];

  // Apply limit per direction if specified
  const outgoing = options?.limit ? outgoingRows.slice(0, options.limit) : outgoingRows;
  const incoming = options?.limit ? incomingRows.slice(0, options.limit) : incomingRows;

  // Build summaries across both directions
  const summary_by_type: Record<string, number> = {};
  const summary_by_source: Record<string, number> = {};

  const tally = (type: string, source: string): void => {
    summary_by_type[type] = (summary_by_type[type] || 0) + 1;
    summary_by_source[source] = (summary_by_source[source] || 0) + 1;
  };

  for (const e of outgoing) tally(e.type, e.source);
  for (const e of incoming) tally(e.type, e.source);

  // Pruning candidates: inferred OR confidence < 0.5
  const pruning_candidates: RelationsPruningCandidate[] = [];
  for (const e of outgoing) {
    if (e.source === 'inferred' || e.confidence < 0.5) {
      pruning_candidates.push({
        edge_id: e.edge_id,
        direction: 'out',
        other_id: e.to_id,
        type: e.type,
        source: e.source,
        confidence: e.confidence,
        reason: e.source === 'inferred' ? 'inferred' : 'low_confidence',
      });
    }
  }
  for (const e of incoming) {
    if (e.source === 'inferred' || e.confidence < 0.5) {
      pruning_candidates.push({
        edge_id: e.edge_id,
        direction: 'in',
        other_id: e.from_id,
        type: e.type,
        source: e.source,
        confidence: e.confidence,
        reason: e.source === 'inferred' ? 'inferred' : 'low_confidence',
      });
    }
  }

  return {
    card_id: cardId,
    outgoing,
    incoming,
    total: outgoing.length + incoming.length,
    summary_by_type,
    summary_by_source,
    pruning_candidates,
  };
}

export interface RelationsCommandOptions {
  type?: string;
  source?: string;
  format?: string;
  limit?: number;
}

export function relationsCommand(cardId: string, options: RelationsCommandOptions): void {
  const pmemPath = path.join(process.cwd(), PMEM_DIR);
  const source = (options.source ?? 'all') as RelationsQueryOptions['source'];
  const result = relationsQuery(pmemPath, cardId, {
    type: options.type,
    source,
    limit: options.limit,
  });

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Compact format
  console.log(`Card: ${result.card_id}`);
  console.log(`Total relations: ${result.total}`);
  console.log(`  Outgoing: ${result.outgoing.length}`);
  console.log(`  Incoming: ${result.incoming.length}`);
  console.log('');
  console.log('By type:', JSON.stringify(result.summary_by_type));
  console.log('By source:', JSON.stringify(result.summary_by_source));

  if (result.pruning_candidates.length > 0) {
    console.log('');
    console.log(`Pruning candidates (${result.pruning_candidates.length}):`);
    const limit = 10;
    const slice = result.pruning_candidates.slice(0, limit);
    for (const p of slice) {
      const arrow = p.direction === 'out' ? `${result.card_id} -> ${p.other_id}` : `${p.other_id} -> ${result.card_id}`;
      console.log(`  - [${p.source}, conf=${p.confidence}, ${p.reason}] ${arrow} (${p.type})`);
    }
    if (result.pruning_candidates.length > limit) {
      console.log(`  ... and ${result.pruning_candidates.length - limit} more (use --format json to see all)`);
    }
  }
}