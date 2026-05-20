import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import type { GraphIndex } from '../types';

const PMEM_DIR = '.pmem';

function loadGraph(): GraphIndex | null {
  const cwd = process.cwd();
  const graphPath = path.join(cwd, PMEM_DIR, 'indexes', 'graph.json');

  if (!fileExists(graphPath)) {
    console.log('No graph index found. Run `pmem rebuild` first.');
    return null;
  }

  const content = readFile(graphPath);
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    console.log('Graph index is malformed. Run `pmem rebuild`.');
    return null;
  }
}

export function relatedCommand(id: string): void {
  const graph = loadGraph();
  if (!graph) return;

  const node = graph.nodes.find(n => n.id === id);
  if (!node) {
    console.log(`Node "${id}" not found in graph.`);
    console.log(`Try: pmem ask "${id}" to search for related nodes.`);
    return;
  }

  const relatedEdges = graph.edges.filter(e => e.from === id || e.to === id);

  console.log(`${node.id}`);
  console.log(`Type: ${node.type}`);
  console.log(`Title: ${node.title}`);

  if (node.status) {
    console.log(`Status: ${node.status}`);
  }

  if (relatedEdges.length === 0) {
    console.log('\nNo related nodes.');
    return;
  }

  // Group edges by type
  const grouped = new Map<string, { targetId: string; targetTitle: string; direction: 'out' | 'in' }[]>();
  for (const edge of relatedEdges) {
    const isOut = edge.from === id;
    const targetId = isOut ? edge.to : edge.from;
    const targetNode = graph.nodes.find(n => n.id === targetId);
    const targetTitle = targetNode ? targetNode.title : targetId;

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
}

export function traceCommand(id: string): void {
  const graph = loadGraph();
  if (!graph) return;

  const node = graph.nodes.find(n => n.id === id);
  if (!node) {
    console.log(`Node "${id}" not found in graph.`);
    return;
  }

  console.log(`Trace for ${node.id}:`);
  console.log(`Type: ${node.type}`);
  console.log(`Title: ${node.title}`);
  console.log(`File: ${node.file}`);

  // Find evidence: decision nodes and trace nodes related to this node
  const relatedEdges = graph.edges.filter(e => (e.from === id || e.to === id));

  const evidenceNodes = new Set<string>();
  for (const edge of relatedEdges) {
    const neighborId = edge.from === id ? edge.to : edge.from;
    const neighborNode = graph.nodes.find(n => n.id === neighborId);
    if (neighborNode && (neighborNode.type === 'decision' || neighborNode.type === 'trace')) {
      evidenceNodes.add(neighborId);
    }
  }

  // Read traces directory for relevant files
  const cwd = process.cwd();
  const tracesDir = path.join(cwd, PMEM_DIR, 'traces');
  const decisionsDir = path.join(cwd, PMEM_DIR, 'decisions');

  console.log('');
  if (evidenceNodes.size > 0) {
    console.log('Evidence Sources:');
    for (const evId of evidenceNodes) {
      const evNode = graph.nodes.find(n => n.id === evId);
      if (evNode) {
        console.log(`  - ${evNode.id}: ${evNode.title}`);
        console.log(`    ${evNode.file}`);
      }
    }
  }

  // Show chain: what this node depends on, and what depends on it
  const dependsOn = graph.edges.filter(e => e.from === id && e.type === 'depends_on');
  const dependedBy = graph.edges.filter(e => e.to === id && e.type === 'depends_on');

  if (dependsOn.length > 0) {
    console.log('\nDepends On:');
    for (const edge of dependsOn) {
      const target = graph.nodes.find(n => n.id === edge.to);
      console.log(`  - ${edge.to}${target ? ` (${target.title})` : ''}`);
    }
  }

  if (dependedBy.length > 0) {
    console.log('\nDepended On By:');
    for (const edge of dependedBy) {
      const target = graph.nodes.find(n => n.id === edge.from);
      console.log(`  - ${edge.from}${target ? ` (${target.title})` : ''}`);
    }
  }

  // Read and display the actual card content
  const filePath = path.join(cwd, node.file);
  if (fileExists(filePath)) {
    const content = readFile(filePath);
    if (content) {
      // Show the body (after frontmatter)
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
      if (bodyMatch) {
        console.log('\n--- Card Content ---');
        console.log(bodyMatch[1].trim().substring(0, 3000));
      }
    }
  }
}
