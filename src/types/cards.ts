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
  /**
   * A float between 0 and 1 indicating how reliable/trustworthy this memory card is.
   * 1.0 = verified fact, 0.0 = pure speculation.
   * Used by verify and scoring.
   */
  confidence?: number;
  /**
   * Array of card IDs that supersede/replace this one.
   * Used by verify to detect stale decisions, and by ask/recall to downgrade superseded cards.
   */
  superseded_by?: string[];
  /**
   * Mandatory classification of what kind of memory this card represents.
   * Used by verify to warn on unclassified cards, and by recall to group output.
   */
  classification?: 'fact' | 'decision' | 'assumption' | 'plan' | 'risk' | 'question';
  /**
   * Trust label indicating the provenance and reliability of this memory.
   * system_trusted = verified by system; user_confirmed = manually verified;
   * agent_generated = produced by AI agent; tool_observed = extracted from tool output;
   * imported_external = from external source; untrusted_content = potentially unreliable.
   */
  trust_label?: 'system_trusted' | 'user_confirmed' | 'application_trusted' | 'agent_generated' | 'tool_observed' | 'imported_external' | 'untrusted_content';
  /**
   * Sensitivity level controlling visibility in recall/context output.
   * secret = never appears in agent context; confidential = limited distribution;
   * internal = project-internal only; personal = individual use; public = unrestricted.
   */
  sensitivity?: 'public' | 'internal' | 'personal' | 'confidential' | 'secret';
  /**
   * Module boundary contract. Applies to module type cards.
   * Defines ownership, interface, invariants, and verification method.
   */
  contract?: {
    owner?: string;
    interface?: string;
    invariants?: string[];
    verification?: string;
  };
}

export interface MemoryCard {
  frontmatter: CardFrontmatter;
  body: string;
  filePath: string;
}
