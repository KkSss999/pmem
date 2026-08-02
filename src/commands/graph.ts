import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import type { CardRow, EdgeRow, CliFormat } from '../types';
import { loadManifest, resolveConfig } from '../core/manifest';
import { openCommandRuntime } from './runtime';
import type { Pmem } from '../runtime';

const PMEM_DIR = '.pmem';

type RelatedCommandResult = Awaited<ReturnType<Pmem['related']>>;

export async function relatedCommand(id: string, options?: {
  depth?: number;
  type?: string;
  format?: CliFormat;
  source?: 'explicit' | 'inferred' | 'mention' | 'all';
}): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const depth = options?.depth ?? 1;
  const edgeTypeFilter = options?.type;
  const fmt = options?.format ?? 'compact';

  let result: RelatedCommandResult;
  let pmem: Pmem | null = null;
  try {
    pmem = await openCommandRuntime(cwd);
    result = await pmem.related(id, {
      depth,
      type: edgeTypeFilter,
      source: options?.source,
    });
  } catch (err: any) {
    if (err?.message === `Node "${id}" not found in database.`) {
      if (fmt === 'json') {
        console.log(JSON.stringify({ error: `Node "${id}" not found` }, null, 2));
      } else {
        console.log(`Node "${id}" not found in database.`);
        console.log(`Try: pmem ask "${id}" to search for related nodes.`);
      }
      return;
    }
    throw err;
  } finally {
    if (pmem) await pmem.close();
  }

  const directEdges = Object.entries(result.edges_by_type).flatMap(([type, items]: [string, any]) =>
    items.map((item: any) => ({ type, ...item }))
  );

  if (fmt === 'json') {
    console.log(JSON.stringify({
      card: result.card,
      total_edges: result.total_edges,
      high_confidence: result.high_confidence,
      needs_review: result.needs_review,
      edges_by_type: result.edges_by_type,
    }, null, 2));
    return;
  }

  // Compact output
  console.log(`${result.card.id}`);
  console.log(`Type: ${result.card.type}`);
  console.log(`Title: ${result.card.title}`);
  if (result.card.status) {
    console.log(`Status: ${result.card.status}`);
  }

  if (directEdges.length === 0) {
    console.log('\nNo related nodes.');
    return;
  }

  console.log('\nDirect Relations:');
  for (const [edgeType, targets] of Object.entries(result.edges_by_type) as Array<[string, any[]]>) {
    for (const t of targets) {
      const prefix = t.direction === 'in' ? '←' : '';
      const srcTag = t.source === 'inferred' ? ` [${t.source}, ${t.confidence.toFixed(1)}]` : '';
      console.log(`  ${prefix}${edgeType}: ${t.target_id} (${t.target_title})${srcTag}`);
    }
  }

  // BFS for multi-hop traversal when depth > 1. Preserve the legacy summary-only
  // CLI output while routing direct read APIs through Pmem Runtime.
  if (depth > 1) {
    const visited = new Set<string>([id]);
    let frontier = new Set<string>();
    for (const edge of directEdges) {
      const neighborId = edge.target_id;
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

      let hopPmem: Pmem | null = null;
      try {
        hopPmem = await openCommandRuntime(cwd);
        for (const frontierId of frontierArr) {
          let hopResult: RelatedCommandResult;
          try {
            hopResult = await hopPmem.related(frontierId, {
              type: edgeTypeFilter,
              source: options?.source,
            });
          } catch {
            continue;
          }

          const hopEdges = Object.values(hopResult.edges_by_type).flat();
          totalExtendedEdges += hopEdges.length;
          for (const edge of hopEdges as any[]) {
            const neighborId = edge.target_id;
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.add(neighborId);
            }
          }
        }
      } finally {
        if (hopPmem) await hopPmem.close();
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

  // trace is a read-only graph command, but no integrated runtime trace API exists
  // yet; keep the existing SQL path to preserve CLI semantics.
  const { openDatabase, createSchema } = require('../core/db');
  const db = openDatabase(pmemPath);
  createSchema(db);

  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND is_deleted = 0').get(id) as CardRow | undefined;
  if (!card) {
    console.log(`Node "${id}" not found in database.`);
    return;
  }
  // v1.1: a secret-sensitivity card is invisible — never print its
  // title/path/body. Report not-found to match recall/ask/related semantics.
  if ((card as any).sensitivity === 'secret') {
    console.log(`Node "${id}" not found in database.`);
    return;
  }

  console.log(`Trace for ${card.id}:`);
  console.log(`Type: ${card.type}`);
  console.log(`Title: ${card.title}`);
  console.log(`File: ${card.file_path}`);

  const manifest = loadManifest(pmemPath);
  const config = manifest ? resolveConfig(manifest) : { evidence_types: ['decision', 'trace'] };
  const evidenceTypes = config.evidence_types;
  const placeholders = evidenceTypes.map(() => '?').join(',');

  // Find evidence: decision and trace type cards connected via edges
  const evidenceRows = (db.prepare(`
    SELECT DISTINCT c.id, c.type, c.title, c.file_path, c.sensitivity
    FROM edges e
    JOIN cards c ON (c.id = e.from_id OR c.id = e.to_id) AND c.id != ?
    WHERE (e.from_id = ? OR e.to_id = ?)
      AND c.type IN (${placeholders})
      AND c.is_deleted = 0
  `).all(id, id, id, ...evidenceTypes) as (CardRow)[])
    // v1.1: never surface secret-sensitivity evidence cards.
    .filter(row => (row as any).sensitivity !== 'secret');

  if (evidenceRows.length > 0) {
    console.log('');
    console.log('Evidence Sources:');
    for (const row of evidenceRows) {
      console.log(`  - ${row.id}: ${row.title}`);
      console.log(`    ${row.file_path}`);
    }
  }

  // Find depends_on chain
  const dependsOn = (db.prepare(`
    SELECT e.to_id, c.title as to_title, c.sensitivity as to_sensitivity, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.to_id AND c.is_deleted = 0
    WHERE e.from_id = ? AND e.type = 'depends_on'
  `).all(id) as { to_id: string; to_title: string | null; to_sensitivity: string | null; source: string; confidence: number }[])
    // v1.1: hide edges pointing at secret-sensitivity cards.
    .filter(row => row.to_sensitivity !== 'secret');

  if (dependsOn.length > 0) {
    console.log('\nDepends On:');
    for (const row of dependsOn) {
      const srcTag = row.source === 'inferred' ? ` [${row.source}, ${row.confidence.toFixed(1)}]` : '';
      console.log(`  - ${row.to_id}${row.to_title ? ` (${row.to_title})` : ''}${srcTag}`);
    }
  }

  // Find depended_by
  const dependedBy = (db.prepare(`
    SELECT e.from_id, c.title as from_title, c.sensitivity as from_sensitivity, e.source, e.confidence
    FROM edges e
    LEFT JOIN cards c ON c.id = e.from_id AND c.is_deleted = 0
    WHERE e.to_id = ? AND e.type = 'depends_on'
  `).all(id) as { from_id: string; from_title: string | null; from_sensitivity: string | null; source: string; confidence: number }[])
    // v1.1: hide edges pointing at secret-sensitivity cards.
    .filter(row => row.from_sensitivity !== 'secret');

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
