import type { RepairPlan } from '../runtime/repair';

export interface VerifyIssue {
  severity: 'error' | 'warning' | 'info';
  type: string;
  message: string;
  fix: string;
  card_id?: string;
  /** Primary evidence path retained for compatibility. */
  file_path?: string;
  /** Health dimension used by the v1.2 scoring model. */
  dimension?: HealthDimension;
  /** Stable identity used to compare this issue with an accepted baseline. */
  fingerprint?: string;
  /** Number of raw observations collapsed into this issue. */
  evidence_count?: number;
  /** All source paths represented by an aggregated issue. */
  file_paths?: string[];
  /** True when the issue is present in the accepted health baseline. */
  historical?: boolean;
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

/** Stable machine-readable health dimensions. The v1.3.3 dimensions are
 * additive; existing correctness/freshness/metadata/semantic scores remain
 * unchanged. */
export type HealthDimension =
  | 'correctness'
  | 'freshness'
  | 'metadata'
  | 'semantic_readiness'
  | 'conflict'
  | 'stability'
  | 'quality';

export interface HealthDimensionResult {
  status: 'applicable' | 'not_applicable';
  score: number | null;
  issue_count: number;
}

export interface HealthBaselineSummary {
  status: 'missing' | 'loaded' | 'invalid';
  path: string;
  historical: number;
  new: number;
  resolved: number;
}

export interface SemanticReadinessSummary {
  applicable: boolean;
  eligible_cards: number;
  excluded_cards: number;
  excluded_by_reason: Record<string, number>;
  /** Additive detail while `excluded_by_reason.untrusted` remains backward-compatible. */
  excluded_by_trust_detail?: Record<string, number>;
  pipeline_version: number | null;
  index_compatible: boolean;
  index_fresh: boolean;
}

export interface VerifyResult {
  passed: boolean;
  /** Backward-compatible alias of overall_score. */
  score: number;
  overall_score: number;
  change_score: number | null;
  dimensions: Record<HealthDimension, HealthDimensionResult>;
  semantic_readiness: SemanticReadinessSummary;
  baseline: HealthBaselineSummary;
  issues: VerifyIssue[];
  /** Optional deterministic preview/receipt for a requested Fix Mode run. */
  repair_plan?: RepairPlan;
}

export interface ConsistencyIssue {
  type: string;
  severity: 'blocking' | 'warning' | 'info';
  card_id?: string;
  file_path?: string;
  file_paths?: string[];
  evidence_count?: number;
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
