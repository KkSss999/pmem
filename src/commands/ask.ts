import * as path from 'path';
import { readFile, fileExists } from '../core/fs';
import type { GraphIndex, GraphNode, AskMatch, AskResult, MatchType } from '../types';

const PMEM_DIR = '.pmem';

export function askCommand(query: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const graphPath = path.join(pmemPath, 'indexes', 'graph.json');

  if (!fileExists(graphPath)) {
    console.log('No graph index found. Run `pmem rebuild` first.');
    return;
  }

  const graphContent = readFile(graphPath);
  if (!graphContent) return;

  const graph: GraphIndex = JSON.parse(graphContent);
  const matches: AskMatch[] = [];

  const normalizedQuery = query.toLowerCase();
  const queryTokens = tokenize(normalizedQuery);

  // Step 1: Exact match (id, title, alias, tag)
  for (const node of graph.nodes) {
    // ID match
    if (node.id.toLowerCase() === normalizedQuery || node.id.toLowerCase().includes(normalizedQuery)) {
      matches.push({ node, matchType: 'exact_id' as MatchType, confidence: 0.95 });
      continue;
    }

    // Title match
    if (node.title.toLowerCase().includes(normalizedQuery)) {
      matches.push({ node, matchType: 'exact_title' as MatchType, confidence: 0.85 });
      continue;
    }

    // Alias match
    if (node.aliases) {
      for (const alias of node.aliases) {
        if (alias.toLowerCase().includes(normalizedQuery) || normalizedQuery.includes(alias.toLowerCase())) {
          matches.push({ node, matchType: 'alias' as MatchType, confidence: 0.9 });
          break;
        }
      }
    }

    // Tag match
    if (node.tags) {
      for (const tag of node.tags) {
        if (queryTokens.some(t => tag.toLowerCase().includes(t) || t.includes(tag.toLowerCase()))) {
          matches.push({ node, matchType: 'tag' as MatchType, confidence: 0.7 });
          break;
        }
      }
    }
  }

  // Step 2: Graph expansion from matched nodes
  const matchedIds = new Set(matches.map(m => m.node.id));
  const expandedNodes: Map<string, { node: GraphNode; graphDistance: number; edgeType: string }> = new Map();

  for (const match of matches) {
    const relatedEdges = graph.edges.filter(e => e.from === match.node.id || e.to === match.node.id);
    for (const edge of relatedEdges) {
      const neighborId = edge.from === match.node.id ? edge.to : edge.from;
      if (!matchedIds.has(neighborId) && !expandedNodes.has(neighborId)) {
        const neighborNode = graph.nodes.find(n => n.id === neighborId);
        if (neighborNode) {
          expandedNodes.set(neighborId, { node: neighborNode, graphDistance: 1, edgeType: edge.type });
          matches.push({
            node: neighborNode,
            matchType: 'graph_expansion' as MatchType,
            confidence: 0.6,
            graphDistance: 1,
          });
        }
      }
    }
  }

  // Step 3: Keyword fallback (BM25-simple: title + tag token overlap)
  if (matches.length === 0) {
    for (const node of graph.nodes) {
      const nodeText = `${node.title} ${(node.tags || []).join(' ')} ${(node.aliases || []).join(' ')}`.toLowerCase();
      const nodeTokens = tokenize(nodeText);
      const overlap = queryTokens.filter(t => nodeTokens.some(nt => nt.includes(t) || t.includes(nt)));
      if (overlap.length > 0) {
        matches.push({
          node,
          matchType: 'keyword_fallback' as MatchType,
          confidence: Math.min(0.5, overlap.length / queryTokens.length),
        });
      }
    }
  }

  // Rank results
  matches.sort((a, b) => {
    const typeOrder: Record<MatchType, number> = {
      exact_id: 5, exact_title: 4, alias: 3, tag: 2, graph_expansion: 1, keyword_fallback: 0
    };
    return (typeOrder[b.matchType] - typeOrder[a.matchType]) || (b.confidence - a.confidence);
  });

  // Build output
  console.log(`Query: ${query}\n`);

  if (matches.length === 0) {
    console.log('No matching memory cards found.');
    console.log('Try: pmem related <id> or add aliases to your cards.');
    return;
  }

  // Show matched nodes with match type
  console.log('Matched:');
  const directMatches = matches.filter(m => m.matchType !== 'graph_expansion');
  for (const m of directMatches) {
    console.log(`- ${m.node.id} by ${m.matchType}: "${m.node.title}"`);
  }

  // Show expanded nodes
  const expansions = matches.filter(m => m.matchType === 'graph_expansion');
  if (expansions.length > 0) {
    console.log('\nExpanded:');
    for (const m of expansions) {
      const edge = graph.edges.find(e =>
        (e.from === m.node.id && matchedIds.has(e.to)) ||
        (e.to === m.node.id && matchedIds.has(e.from))
      );
      const via = edge ? edge.type : 'related_to';
      const viaNodeId = edge ? (edge.from === m.node.id ? edge.to : edge.from) : '?';
      console.log(`- ${m.node.id} via ${via} from ${viaNodeId}`);
    }
  }

  console.log('\nRecommended Read:');
  for (const m of matches.slice(0, 6)) {
    console.log(`  ${m.node.file}`);
  }

  // Evidence paths
  const evidencePaths = matches
    .filter(m => m.node.type === 'decision' || m.node.type === 'trace')
    .map(m => m.node.file);
  if (evidencePaths.length > 0) {
    console.log('\nEvidence:');
    for (const ep of evidencePaths) {
      console.log(`  - ${ep}`);
    }
  }
}

function tokenize(text: string): string[] {
  // Simple CJK + English tokenizer
  const tokens: string[] = [];
  // Split on whitespace and punctuation, keep CJK chars and alphanumeric
  const words = text.split(/[\s,，。、；;：:！!？?()（）\[\]【】{}]+/);
  for (const word of words) {
    if (word.length === 0) continue;
    // For CJK, split each char
    if (/[一-鿿]/.test(word)) {
      const cjkChars = word.match(/[一-鿿]/g) || [];
      tokens.push(...cjkChars);
      // Also keep the whole word if it has non-CJK parts
      const nonCjk = word.replace(/[一-鿿]/g, '').trim();
      if (nonCjk) tokens.push(nonCjk.toLowerCase());
    } else {
      tokens.push(word.toLowerCase());
    }
  }
  return [...new Set(tokens)];
}
