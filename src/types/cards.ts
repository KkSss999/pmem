// v0.7.0: NodeType is now string (was a hardcoded union).
// Card type validation is done at runtime via manifest.schema.card_types.
// This change allows custom domain types (character, chapter, world, arc, ...).
export type NodeType = string;

export type NodeStatus = 'active' | 'designing' | 'implementing' | 'completed' | 'archived' | 'blocked';

export type CardPriority = 'high' | 'medium' | 'low';

export interface CardFrontmatter {
  id: string;
  type: NodeType;
  status?: NodeStatus;
  priority?: CardPriority;
  tags?: string[];
  aliases?: string[];
  schema_version?: string;
  version?: number;
  related?: string[];
  depends_on?: string[];
  updated?: string;
  last_verified?: string;
  freshness?: {
    ttl: string;
    policy: string;
  };
  source_files?: string[];
}

export interface MemoryCard {
  frontmatter: CardFrontmatter;
  body: string;
  filePath: string;
}
