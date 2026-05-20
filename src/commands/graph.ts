import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import { openDatabase, createSchema } from '../core/db';
import type { CardRow, EdgeRow } from '../types';

const PMEM_DIR = '.pmem';

export function relatedCommand(id: string, options?: { depth?: number; type?: string }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const depth = options?.depth ?? 1;
  const edgeTypeFilter = options?.type;

  const db = openDatabase(pmemPath);
  createSchema(db);

  // Query card by ID
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id) as CardRow | undefined;
  if (!card) {
    console.log(`Node "${id}" not found in database.`);
    console.log(`Try: pmem ask "${id}" to search for related nodes.`);
    return;
  }

  // Query direct edges
  let directQuery = 'SELECT * FROM edges WHERE (from_id = ? OR to_id = ?)';
  const directParams: unknown[] = [id, id];
  if (edgeTypeFilter) {
    directQuery += ' AND type = ?';
    directParams.push(edgeTypeFilter);
  }
  const directEdges = db.prepare(directQuery).all(...directParams) as EdgeRow[];

  // Helper to fetch a card by ID
  const getCard = (cardId: string): CardRow | undefined => {
    return db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(cardId) as CardRow | undefined;
  };

  // Output node info
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

  // Group direct edges by type
  const grouped = new Map<string, { targetId: string; targetTitle: string; direction: 'out' | 'in' }[]>();
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
    });
  }

  console.log('\nDirect Relations:');
  for (const [edgeType, targets] of grouped) {
    for (const t of targets) {
      const prefix = t.direction === 'in' ? '←' : '';
      console.log(`  ${prefix}${edgeType}: ${t.targetId} (${t.targetTitle})`);
    }
  }

  // BFS for multi-hop traversal when depth > 1
  if (depth > 1) {
    const visited = new Set<string>([id]);

    // Seed frontier with direct neighbors
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

    const totalReachable = visited.size - 1; // excluding the target itself
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

  // Query card by ID
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

  // Find depends_on chain: edges where this node depends on others
  const dependsOn = db.prepare(`
    SELECT e.to_id, c.title as to_title
    FROM edges e
    LEFT JOIN cards c ON c.id = e.to_id AND c.is_deleted = 0
    WHERE e.from_id = ? AND e.type = 'depends_on'
  `).all(id) as { to_id: string; to_title: string | null }[];

  if (dependsOn.length > 0) {
    console.log('\nDepends On:');
    for (const row of dependsOn) {
      console.log(`  - ${row.to_id}${row.to_title ? ` (${row.to_title})` : ''}`);
    }
  }

  // Find depended_by: edges where other nodes depend on this node
  const dependedBy = db.prepare(`
    SELECT e.from_id, c.title as from_title
    FROM edges e
    LEFT JOIN cards c ON c.id = e.from_id AND c.is_deleted = 0
    WHERE e.to_id = ? AND e.type = 'depends_on'
  `).all(id) as { from_id: string; from_title: string | null }[];

  if (dependedBy.length > 0) {
    console.log('\nDepended On By:');
    for (const row of dependedBy) {
      console.log(`  - ${row.from_id}${row.from_title ? ` (${row.from_title})` : ''}`);
    }
  }

  // Read and display card body content (first 3000 chars after frontmatter)
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
