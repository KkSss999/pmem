import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import { openDatabase, createSchema, getEdgesForCard } from '../core/db';
import type { CardRow, EdgeRow, CliFormat } from '../types';

const PMEM_DIR = '.pmem';

export function relatedCommand(id: string, options?: {
  depth?: number;
  type?: string;
  format?: CliFormat;
  source?: 'explicit' | 'inferred' | 'mention' | 'all';
}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const depth = options?.depth ?? 1;
  const edgeTypeFilter = options?.type;
  const fmt = options?.format ?? 'compact';
  const sourceFilter = (options?.source && options.source !== 'all')
    ? options.source
    : undefined;

  const db = openDatabase(pmemPath);
  createSchema(db);

  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id) as CardRow | undefined;
  if (!card) {
    if (fmt === 'json') {
      console.log(JSON.stringify({ error: `Node "${id}" not found` }, null, 2));
    } else {
      console.log(`Node "${id}" not found in database.`);
      console.log(`Try: pmem ask "${id}" to search for related nodes.`);
    }
    return;
  }

  let directEdges = getEdgesForCard(db, id, sourceFilter) as EdgeRow[];
  if (edgeTypeFilter) {
    directEdges = directEdges.filter(e => e.type === edgeTypeFilter);
  }

  const getCard = (cardId: string): CardRow | undefined => {
    return db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(cardId) as CardRow | undefined;
  };

  if (fmt === 'json') {
    const edgesByType: Record<string, Array<{
      direction: 'out' | 'in';
      target_id: string;
      target_title: string;
      source: string;
      confidence: number;
    }>> = {};

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
        source: edge.source,
        confidence: edge.confidence,
      });
    }

    const highConfidence: typeof edgesByType[string] = [];
    const needsReview: typeof edgesByType[string] = [];

    for (const items of Object.values(edgesByType)) {
      for (const item of items) {
        if (item.source === 'inferred' && item.confidence < 0.7) {
          needsReview.push(item);
        } else {
          highConfidence.push(item);
        }
      }
    }

    console.log(JSON.stringify({
      card: { id: card.id, type: card.type, title: card.title, status: card.status, file: card.file_path },
      total_edges: directEdges.length,
      high_confidence: highConfidence,
      needs_review: needsReview,
      edges_by_type: edgesByType,
    }, null, 2));
    return;
  }

  // Compact output
  console.log(`${card.id}`);
  console.log(`Type: ${card.type}`);
  console.log(`Title: ${card.title}`);
  if (card.status) {
    console.log(`Status: ${card.status}`);
  }

  if (directEdges.length === 0) {
    console.log('\nNo related nodes.');
    return;
  }

  const grouped = new Map<string, { targetId: string; targetTitle: string; direction: 'out' | 'in'; source: string; confidence: number }[]>();
  for (const edge of directEdges) {
    const isOut = edge.from_id === id;
    const targetId = isOut ? edge.to_id : edge.from_id;
    const targetCard = getCard(targetId);
    const targetTitle = targetCard ? targetCard.title : targetId;

    if (!grouped.has(edge.type)) {
      grouped.set(edge.type, []);
    }
    grouped.get(edge.type)!.push({
      targetId,
      targetTitle,
      direction: isOut ? 'out' : 'in',
      source: edge.source,
      confidence: edge.confidence,
    });
  }

  console.log('\nDirect Relations:');
  for (const [edgeType, targets] of grouped) {
    for (const t of targets) {
      const prefix = t.direction === 'in' ? '←' : '';
      const srcTag = t.source === 'inferred' ? ` [${t.source}, ${t.confidence.toFixed(1)}]` : '';
      console.log(`  ${prefix}${edgeType}: ${t.targetId} (${t.targetTitle})${srcTag}`);
    }
  }

  // BFS for multi-hop traversal when depth > 1
  if (depth > 1) {
    const visited = new Set<string>([id]);
    let frontier = new Set<string>();
    for (const edge of directEdges) {
      const neighborId = edge.from_id === id ? edge.to_id : edge.from_id;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        frontier.add(neighborId);
      }
    }

    let totalExtendedEdges = 0;
    for (let hop = 1; hop < depth; hop++) {
      if (frontier.size === 0) break;
      const frontierArr = Array.from(frontier);
      const nextFrontier = new Set<string>();

      const placeholders = frontierArr.map(() => '?').join(',');
      let edgeQuery = `SELECT * FROM edges WHERE (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`;
      const params: unknown[] = [...frontierArr, ...frontierArr];
      if (edgeTypeFilter) {
        edgeQuery += ' AND type = ?';
        params.push(edgeTypeFilter);
      }

      const hopEdges = db.prepare(edgeQuery).all(...params) as EdgeRow[];
      totalExtendedEdges += hopEdges.length;

      for (const edge of hopEdges) {
        const neighborId = frontier.has(edge.from_id) ? edge.to_id : edge.from_id;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          nextFrontier.add(neighborId);
        }
      }

      frontier = nextFrontier;
    }

    const totalReachable = visited.size - 1;
    if (totalReachable > 0) {
      console.log(`\nExtended Network (depth ${depth}):`);
      console.log(`  ${totalReachable} reachable node(s) via ${totalExtendedEdges + directEdges.length} edge(s) across all hops`);
    }
  }
}

export function traceCommand(id: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  const db = openDatabase(pmemPath);
  createSchema(db);

  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id) as CardRow | undefined;
  if (!card) {
    console.log(`Node "${id}" not found in database.`);
    return;
  }

  console.log(`Trace for ${card.id}:`);
  console.log(`Type: ${card.type}`);
  console.log(`Title: ${card.title}`);
  console.log(`File: ${card.file_path}`);

  // Find evidence: decision and trace type cards connected via edges
  const evidenceRows = db.prepare(`
    SELECT DISTINCT c.id, c.type, c.title, c.file_path
    FROM edges e
    JOIN cards c ON (c.id = e.from_id OR c.id = e.to_id) AND c.id != ?
    WHERE (e.from_id = ? OR e.to_id = ?)
      AND (c.type = 'decision' OR c.type = 'trace')
      AND c.is_deleted = 0
  `).all(id, id, id) as (CardRow)[];

  if (evidenceRows.length > 0) {
    console.log('');
    console.log('Evidence Sources:');
    for (const row of evidenceRows) {
      console.log(`  - ${row.id}: ${row.title}`);
      console.log(`    ${row.file_path}`);
    }
  }

  // Find depends_on chain
  const dependsOn = db.prepare(`
    SELECT e.to_id, c.title as to_title, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.to_id AND c.is_deleted = 0
    WHERE e.from_id = ? AND e.type = 'depends_on'
  `).all(id) as { to_id: string; to_title: string | null; source: string; confidence: number }[];

  if (dependsOn.length > 0) {
    console.log('\nDepends On:');
    for (const row of dependsOn) {
      const srcTag = row.source === 'inferred' ? ` [${row.source}, ${row.confidence.toFixed(1)}]` : '';
      console.log(`  - ${row.to_id}${row.to_title ? ` (${row.to_title})` : ''}${srcTag}`);
    }
  }

  // Find depended_by
  const dependedBy = db.prepare(`
    SELECT e.from_id, c.title as from_title, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.from_id AND c.is_deleted = 0
    WHERE e.to_id = ? AND e.type = 'depends_on'
  `).all(id) as { from_id: string; from_title: string | null; source: string; confidence: number }[];

  if (dependedBy.length > 0) {
    console.log('\nDepended On By:');
    for (const row of dependedBy) {
      const srcTag = row.source === 'inferred' ? ` [${row.source}, ${row.confidence.toFixed(1)}]` : '';
      console.log(`  - ${row.from_id}${row.from_title ? ` (${row.from_title})` : ''}${srcTag}`);
    }
  }

  // Read and display card body content
  const filePath = path.join(cwd, card.file_path);
  if (fileExists(filePath)) {
    const content = readFile(filePath);
    if (content) {
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
      if (bodyMatch) {
        console.log('\n--- Card Content ---');
        console.log(bodyMatch[1].trim().substring(0, 3000));
      }
    }
  }
}
