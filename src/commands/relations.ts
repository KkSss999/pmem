import * as path from 'path';
import { fileExists } from '../core/fs';
import { Pmem } from '../runtime';

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

export async function relationsQuery(
  pmemPath: string,
  cardId: string,
  options?: RelationsQueryOptions
): Promise<RelationsQueryResult> {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }

  const root = path.dirname(pmemPath);
  let pmem: Pmem | null = null;
  try {
    pmem = await Pmem.open({ root });
    const related = await pmem.related(cardId, {
      type: options?.type,
      source: options?.source === 'manual' ? undefined : options?.source,
    });

    // Preserve the legacy relations API shape: outgoing/incoming arrays, limit
    // per direction, summaries over returned rows, and pruning candidates.
    const outgoingRows: RelationsEdgeOut[] = [];
    const incomingRows: RelationsEdgeIn[] = [];
    let syntheticEdgeId = 1;

    for (const [type, items] of Object.entries(related.edges_by_type)) {
      for (const item of items) {
        const edgeId = syntheticEdgeId++;
        if (item.direction === 'out') {
          outgoingRows.push({
            edge_id: edgeId,
            to_id: item.target_id,
            type,
            source: item.source,
            confidence: item.confidence,
          });
        } else {
          incomingRows.push({
            edge_id: edgeId,
            from_id: item.target_id,
            type,
            source: item.source,
            confidence: item.confidence,
          });
        }
      }
    }

    const compareEdges = (a: { edge_id: number; confidence: number }, b: { edge_id: number; confidence: number }) =>
      a.confidence - b.confidence || a.edge_id - b.edge_id;
    outgoingRows.sort(compareEdges);
    incomingRows.sort(compareEdges);

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
  } catch (err: any) {
    if (err?.message === `Node "${cardId}" not found in database.`) {
      throw new Error(`Card "${cardId}" not found.`);
    }
    throw err;
  } finally {
    if (pmem) await pmem.close();
  }
}

export interface RelationsCommandOptions {
  type?: string;
  source?: string;
  format?: string;
  limit?: number;
}

export async function relationsCommand(cardId: string, options: RelationsCommandOptions): Promise<void> {
  const pmemPath = path.join(process.cwd(), PMEM_DIR);
  const source = (options.source ?? 'all') as RelationsQueryOptions['source'];
  const result = await relationsQuery(pmemPath, cardId, {
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