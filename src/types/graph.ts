import type { NodeStatus, NodeType } from './cards';

export type EdgeType =
  | 'depends_on'
  | 'blocks'
  | 'implements'
  | 'constrains'
  | 'decided_by'
  | 'derived_from'
  | 'related_to'
  | 'references'
  | 'supersedes'
  | 'conflicts_with'
  | 'next_step_of';

export interface GraphNode {
  id: string;
  type: NodeType;
  title: string;
  status?: NodeStatus;
  file: string;
  tags?: string[];
  aliases?: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence?: number;
  derived?: boolean;
}

export interface GraphIndex {
  kind: 'pmem.graph_index';
  pmem_version: string;
  generated_at: string;
  source: {
    type: 'markdown_frontmatter';
    glob: string;
    source_hash: string;
  };
  node_count: number;
  edge_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
