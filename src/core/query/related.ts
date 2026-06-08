import * as path from 'path';
import { fileExists } from '../fs';
import { openDatabase, createSchema, getEdgesForCard } from '../db';
import type { CardRow, EdgeRow } from '../../types';

interface RelatedEdgeItem {
  direction: 'out' | 'in';
  target_id: string;
  target_title: string;
  target_type: string;
  target_status: string | null;
  source: string;
  confidence: number;
}

export interface RelatedResult {
  card: {
    id: string;
    type: string;
    title: string;
    status: string | null;
    file: string;
  };
  total_edges: number;
  edges_by_type: Record<string, RelatedEdgeItem[]>;
  high_confidence: RelatedEdgeItem[];
  needs_review: RelatedEdgeItem[];
}

export function relatedQuery(pmemPath: string, id: string, options?: {
  depth?: number;
  type?: string;
  source?: 'explicit' | 'inferred' | 'mention' | 'all';
}): RelatedResult {
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    throw new Error('No SQLite database found. Run `pmem rebuild` first.');
  }

  const edgeTypeFilter = options?.type;
  const sourceFilter = (options?.source && options.source !== 'all')
    ? options.source
    : undefined;

  const db = openDatabase(pmemPath);
  createSchema(db);

  const card = db.prepare(
    'SELECT * FROM cards WHERE id = ? AND is_deleted = 0'
  ).get(id) as CardRow | undefined;

  if (!card) {
    throw new Error(`Node "${id}" not found in database.`);
  }

  let directEdges = getEdgesForCard(db, id, sourceFilter) as EdgeRow[];
  if (edgeTypeFilter) {
    directEdges = directEdges.filter(e => e.type === edgeTypeFilter);
  }

  const getCard = (cardId: string): CardRow | undefined => {
    return db.prepare(
      'SELECT * FROM cards WHERE id = ? AND is_deleted = 0'
    ).get(cardId) as CardRow | undefined;
  };

  const edgesByType: Record<string, RelatedEdgeItem[]> = {};

  for (const edge of directEdges) {
    const isOut = edge.from_id === id;
    const targetId = isOut ? edge.to_id : edge.from_id;
    const targetCard = getCard(targetId);

    if (!edgesByType[edge.type]) {
      edgesByType[edge.type] = [];
    }
    edgesByType[edge.type].push({
      direction: isOut ? 'out' : 'in',
      target_id: targetId,
      target_title: targetCard?.title ?? targetId,
      target_type: targetCard?.type ?? 'unknown',
      target_status: targetCard?.status ?? null,
      source: edge.source,
      confidence: edge.confidence,
    });
  }

  const highConfidence: RelatedEdgeItem[] = [];
  const needsReview: RelatedEdgeItem[] = [];

  for (const items of Object.values(edgesByType)) {
    for (const item of items) {
      if (item.source === 'inferred' && item.confidence < 0.7) {
        needsReview.push(item);
      } else {
        highConfidence.push(item);
      }
    }
  }

  return {
    card: {
      id: card.id,
      type: card.type,
      title: card.title,
      status: card.status,
      file: card.file_path,
    },
    total_edges: directEdges.length,
    edges_by_type: edgesByType,
    high_confidence: highConfidence,
    needs_review: needsReview,
  };
}
