import * as path from 'path';
import { readFile, writeFile, writeJson, listFiles, ensureDir } from '../core/fs';
import { loadManifest } from '../core/manifest';
import type { CardFrontmatter, GraphNode, GraphEdge, GraphIndex } from '../types';
import * as crypto from 'crypto';

const PMEM_DIR = '.pmem';

export function rebuildCommand(): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    console.log('No .pmem/manifest.yml found. Run `pmem init` first.');
    return;
  }

  console.log('Scanning memory cards...');

  // Scan all .md files in card directories
  const cardFiles = listFiles(pmemPath, /\.md$/).filter(f => {
    // Exclude index, state, next — these aren't node cards
    const rel = path.relative(pmemPath, f);
    return !['index.md', 'state.md', 'next.md'].includes(rel) &&
           !rel.startsWith('skills/') &&
           !rel.startsWith('integrations/') &&
           !rel.startsWith('summaries/') &&
           !rel.startsWith('indexes/');
  });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const file of cardFiles) {
    const frontmatter = parseFrontmatter(file);
    if (!frontmatter || !frontmatter.id) continue;

    const relPath = path.relative(cwd, file);
    const bodyContent = readFile(file) || '';
    const title = extractTitle(bodyContent) || frontmatter.id;

    const node: GraphNode = {
      id: frontmatter.id,
      type: frontmatter.type,
      title,
      status: frontmatter.status,
      file: relPath,
      tags: frontmatter.tags,
      aliases: frontmatter.aliases,
    };
    nodes.push(node);

    // Extract explicit edges from frontmatter
    if (frontmatter.depends_on) {
      for (const target of frontmatter.depends_on) {
        edges.push({ from: frontmatter.id, to: target, type: 'depends_on' });
      }
    }
    if (frontmatter.related) {
      for (const target of frontmatter.related) {
        edges.push({ from: frontmatter.id, to: target, type: 'related_to' });
      }
    }

    // Derived edge: task → module
    if (frontmatter.type === 'task' && frontmatter.related) {
      for (const target of frontmatter.related) {
        if (target.startsWith('module.')) {
          edges.push({ from: frontmatter.id, to: target, type: 'next_step_of', derived: true });
        }
      }
    }
  }

  // Compute source hash
  const allContent = cardFiles.map(f => readFile(f) || '').join('');
  const sourceHash = crypto.createHash('sha256').update(allContent).digest('hex').substring(0, 16);

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

  // Write graph index
  const indexesDir = path.join(pmemPath, 'indexes');
  ensureDir(indexesDir);
  writeJson(path.join(indexesDir, 'graph.json'), graphIndex);

  console.log(`✓ Rebuilt graph index: ${nodes.length} nodes, ${edges.length} edges`);
  console.log(`  Source hash: ${sourceHash}`);
}

function parseFrontmatter(filePath: string): CardFrontmatter | null {
  const content = readFile(filePath);
  if (!content) return null;

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yamlBlock = match[1];
  return parseSimpleYaml(yamlBlock) as unknown as CardFrontmatter;
}

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
    return val.slice(1, -1).split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1'));
  }
  return val.replace(/^"(.*)"$/, '$1');
}

function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}
