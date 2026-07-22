export interface VerifyIssue {
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  fix: string;
  card_id?: string;
  /**
   * v0.7.6 (issue #10): for `too_many_relations` — count of related edges.
   */
  relation_count?: number;
  /**
   * v0.7.6 (issue #10): for `too_many_relations` — threshold that was exceeded.
   */
  threshold?: number;
  /**
   * v0.7.6 (issue #10): for `too_many_relations` — up to 10 edges attached to
   * the card, sorted by ascending confidence so the most-likely-prunable edges
   * appear first.
   */
  top_edges?: Array<{
    from_id: string;
    to_id: string;
    type: string;
    source: string;
    confidence: number;
  }>;
  /**
   * v0.7.6 (issue #10): for `too_many_relations` — subset of `top_edges`
   * that are inferred (`source = 'inferred'`) or low-confidence (`confidence < 0.5`).
   * These are the best candidates for pruning.
   */
  pruning_candidates?: Array<{
    from_id: string;
    to_id: string;
    type: string;
    source: string;
    confidence: number;
  }>;
}

export interface VerifyResult {
  passed: boolean;
  score: number;
  issues: VerifyIssue[];
}

export interface ConsistencyIssue {
  type: string;
  severity: 'blocking' | 'warning' | 'info';
  card_id?: string;
  file_path?: string;
  message: string;
}

export interface AggregatedSuggestion {
  target: string;
  reason: string;
  matched_file: string | null;
  count: number;
  severity: 'blocking' | 'warning' | 'info';
  blocks_verify: boolean;
  is_duplicate: boolean;
  is_historical: boolean;
  created_at_first: string;
  created_at_last: string;
  sources: Array<{
    scope: string;
    target: string;
    reason: string;
    created_at: string;
    session_id: string | null;
  }>;
  /**
   * For inferred-edge suggestions: the DB ids of the edges in this group.
   * Pass these to `pmem update --confirm --accept-edges <ids>` or `--reject-edges <ids>`.
   */
  edge_ids?: number[];
  /**
   * For inferred-edge suggestions: the edge tuple (from_id → to_id) for readability.
   */
  edge_tuple?: string;
}

export interface SuggestSummary {
  affected_cards: number;
  blocking: number;
  warning: number;
  info: number;
  duplicates_hidden: number;
  historical_hidden: number;
  verify_blocking: boolean;
}

export interface SuggestGroups {
  blocking_for_verify: AggregatedSuggestion[];
  current_suggestions: AggregatedSuggestion[];
  historical_dirty_flags: AggregatedSuggestion[];
}
