import * as path from 'path';
import { readFile, writeJson, listFiles, ensureDir } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { openDatabase, createSchema, upsertCard, deleteCardEdges, insertEdge, deleteCardAliases, insertAlias, deleteCardTags, insertTag, deleteCardPaths, insertPath, clearAllTables, getCardHash, setSchemaVersion, closeDatabase, createFTS5 } from '../core/db';
import { computeCardHashes, tokenCount, sectionCount, computeHash } from '../core/hash';
import type { CardFrontmatter, GraphNode, GraphEdge, GraphIndex, CardRow, EdgeRow } from '../types';

const PMEM_DIR = '.pmem';

interface RebuildOptions {
  changed?: boolean;
  full?: boolean;
  card?: string;
}

interface ParsedCard {
  fullContent: string;
  frontmatterText: string;
  bodyText: string;
  frontmatter: CardFrontmatter;
}

export function rebuildCommand(options: RebuildOptions = {}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    console.log('No .pmem/manifest.yml found. Run `pmem init` first.');
    return;
  }

  const db = openDatabase(pmemPath);
  createSchema(db);
  setSchemaVersion(db, manifest.pmem.schema_version);

  const isFull = options.full === true;
  const isSingleCard = typeof options.card === 'string';

  if (isFull) {
    clearAllTables(db);
    console.log('Full rebuild: cleared all tables.');
  }

  // Scan all .md files under .pmem/, excluding non-card files
  const cardFiles = listFiles(pmemPath, /\.md$/).filter(f => {
    const rel = path.relative(pmemPath, f);
    return !['index.md', 'state.md', 'next.md'].includes(rel) &&
           !rel.startsWith('skills/') &&
           !rel.startsWith('integrations/') &&
           !rel.startsWith('summaries/') &&
           !rel.startsWith('indexes/') &&
           !rel.startsWith('backups/');
  });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let processed = 0;
  let skipped = 0;
  let updated = 0;

  // Wrap all per-card SQLite writes in a single transaction for performance
  const doRebuild = db.transaction(() => {
    for (const file of cardFiles) {
      const parsed = parseCard(file);
      if (!parsed) continue;

      // In --card mode, skip cards that don't match the target ID
      if (isSingleCard && parsed.frontmatter.id !== options.card) continue;

      const relPath = path.relative(cwd, file);
      processed++;

      const fm = parsed.frontmatter;
      const title = extractTitle(parsed.bodyText) || fm.id;

      // Build legacy graph node (always, for backward compat output)
      nodes.push({
        id: fm.id,
        type: fm.type,
        title,
        status: fm.status,
        file: relPath,
        tags: fm.tags,
        aliases: fm.aliases,
      });

      // Build legacy graph edges (always, for backward compat output)
      collectLegacyEdges(fm, edges);

      // Compute content hashes
      const hashes = computeCardHashes(parsed.fullContent, parsed.frontmatterText, parsed.bodyText);

      // In --changed mode, skip cards whose hashes match what's in SQLite
      if (!isFull) {
        const existing = getCardHash(db, relPath);
        if (
          existing &&
          existing.file_hash === hashes.fileHash &&
          existing.frontmatter_hash === hashes.frontmatterHash &&
          existing.body_hash === hashes.bodyHash
        ) {
          skipped++;
          continue;
        }
      }

      updated++;

      const tokCount = tokenCount(parsed.fullContent);
      const secCount = sectionCount(parsed.bodyText);
      const isCandidate = relPath.includes('/candidates/') ? 1 : 0;

      // Build CardRow and upsert
      const cardRow: CardRow = {
        id: fm.id,
        type: fm.type,
        title,
        status: fm.status ?? null,
        priority: fm.priority ?? null,
        file_path: relPath,
        summary: null,
        schema_version: fm.schema_version ?? null,
        card_version: fm.version ?? 1,
        created_at: null,
        updated_at: fm.updated ?? null,
        last_verified_at: fm.last_verified ?? null,
        file_hash: hashes.fileHash,
        frontmatter_hash: hashes.frontmatterHash,
        body_hash: hashes.bodyHash,
        token_count: tokCount,
        section_count: secCount,
        is_deleted: 0,
        is_candidate: isCandidate,
      };

      upsertCard(db, cardRow);

      // Clear existing relations before re-inserting
      deleteCardEdges(db, fm.id);
      deleteCardAliases(db, fm.id);
      deleteCardTags(db, fm.id);
      deleteCardPaths(db, fm.id);

      // Re-insert aliases
      if (fm.aliases) {
        for (const alias of fm.aliases) {
          insertAlias(db, fm.id, alias);
        }
      }

      // Re-insert tags
      if (fm.tags) {
        for (const tag of fm.tags) {
          insertTag(db, fm.id, tag);
        }
      }

      // Re-insert source_files as paths
      if (fm.source_files) {
        for (const sf of fm.source_files) {
          insertPath(db, fm.id, sf, 'source_file');
        }
      }

      const now = new Date().toISOString();

      // Insert depends_on edges
      if (fm.depends_on) {
        for (const target of fm.depends_on) {
          const edgeRow: EdgeRow = {
            from_id: fm.id,
            to_id: target,
            type: 'depends_on',
            source: 'explicit',
            confidence: 1.0,
            created_at: now,
            updated_at: now,
          };
          insertEdge(db, edgeRow);
        }
      }

      // Insert related_to edges
      if (fm.related) {
        for (const target of fm.related) {
          const edgeRow: EdgeRow = {
            from_id: fm.id,
            to_id: target,
            type: 'related_to',
            source: 'explicit',
            confidence: 1.0,
            created_at: now,
            updated_at: now,
          };
          insertEdge(db, edgeRow);
        }
      }

      // Derived edges: task type with module.* related → next_step_of
      if (fm.type === 'task' && fm.related) {
        for (const target of fm.related) {
          if (target.startsWith('module.')) {
            const edgeRow: EdgeRow = {
              from_id: fm.id,
              to_id: target,
              type: 'next_step_of',
              source: 'inferred',
              confidence: 0.8,
              created_at: now,
              updated_at: now,
            };
            insertEdge(db, edgeRow);
          }
        }
      }
    }
  });

  // Execute all SQLite writes in a single transaction
  doRebuild();

  // Create FTS5 virtual table for full-text search (outside transaction)
  createFTS5(db);

  // Write legacy graph.json for backward compatibility
  const allContent = cardFiles.map(f => readFile(f) || '').join('');
  const sourceHash = computeHash(allContent);

  const graphIndex: GraphIndex = {
    kind: 'pmem.graph_index',
    pmem_version: manifest.pmem.protocol_version,
    generated_at: new Date().toISOString(),
    source: {
      type: 'markdown_frontmatter',
      glob: '.pmem/**/*.md',
      source_hash: sourceHash,
    },
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  };

  const indexesDir = path.join(pmemPath, 'indexes');
  ensureDir(indexesDir);
  writeJson(path.join(indexesDir, 'graph.json'), graphIndex);

  // Output summary
  const modeLabel = isFull
    ? 'Full rebuild'
    : isSingleCard
      ? `Single card: ${options.card}`
      : 'Incremental rebuild';
  console.log(`${modeLabel}: ${processed} cards processed, ${skipped} skipped (hash match), ${updated} updated`);
  console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

  closeDatabase();
}

/**
 * Parse a .md memory card file into its constituent parts.
 * Reads the file once, extracts YAML frontmatter (between --- markers),
 * the markdown body, and parses the frontmatter into a CardFrontmatter object.
 */
function parseCard(filePath: string): ParsedCard | null {
  const fullContent = readFile(filePath);
  if (!fullContent) return null;

  const match = fullContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatterText = match[1];
  const bodyText = match[2] || '';
  const frontmatter = parseSimpleYaml(frontmatterText) as unknown as CardFrontmatter;
  if (!frontmatter.id) return null;

  return { fullContent, frontmatterText, bodyText, frontmatter };
}

/**
 * Simple inline YAML parser for pmem's constrained frontmatter format.
 * Handles: top-level scalars, nested objects (one level), list items, inline arrays.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentArrayKey: string | null = null;
  let currentSubKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === '') continue;

    // Sub-object key: "  key: value"
    const subMatch = line.match(/^  (\w[\w_]*):\s*(.*)/);
    if (subMatch) {
      const key = subMatch[1];
      const val = subMatch[2].trim();
      if (val === '') {
        currentSubKey = key;
        if (!result[currentArrayKey || '']) result[currentArrayKey || ''] = {};
        continue;
      }
      if (currentArrayKey) {
        if (!result[currentArrayKey]) result[currentArrayKey] = {};
        (result[currentArrayKey] as Record<string, unknown>)[key] = parseYamlValue(val);
      } else {
        result[key] = parseYamlValue(val);
      }
      continue;
    }

    // Array item: "  - value"
    const arrMatch = line.match(/^  -\s*(.*)/);
    if (arrMatch) {
      const val = arrMatch[1].trim();
      const arrKey = currentSubKey || currentArrayKey;
      if (arrKey) {
        if (!result[arrKey]) result[arrKey] = [];
        (result[arrKey] as string[]).push(val);
      }
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (topMatch) {
      const key = topMatch[1];
      const val = topMatch[2].trim();
      if (val === '') {
        currentArrayKey = key;
        currentSubKey = null;
      } else {
        result[key] = parseYamlValue(val);
        currentArrayKey = null;
        currentSubKey = null;
      }
    }
  }

  return result;
}

function parseYamlValue(val: string): string | boolean | number | string[] {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Inline array: [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(s => s.length > 0);
  }
  return val.replace(/^"(.*)"$/, '$1');
}

/** Extract the first # heading from markdown body text as the card title. */
function extractTitle(bodyText: string): string | null {
  const match = bodyText.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** Build legacy GraphEdge entries from a card's frontmatter (for backward-compat graph.json). */
function collectLegacyEdges(fm: CardFrontmatter, edges: GraphEdge[]): void {
  if (fm.depends_on) {
    for (const target of fm.depends_on) {
      edges.push({ from: fm.id, to: target, type: 'depends_on' });
    }
  }
  if (fm.related) {
    for (const target of fm.related) {
      edges.push({ from: fm.id, to: target, type: 'related_to' });
    }
  }
  // Derived edge: task → module
  if (fm.type === 'task' && fm.related) {
    for (const target of fm.related) {
      if (target.startsWith('module.')) {
        edges.push({ from: fm.id, to: target, type: 'next_step_of', derived: true });
      }
    }
  }
}
