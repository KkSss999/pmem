import type {
  HealthBaselineSummary,
  HealthDimension,
  HealthDimensionResult,
  VerifyIssue,
  VerifyResult,
  SemanticReadinessSummary,
} from '../../types';
import { healthRule } from './registry';
import type { HealthBaselineFile } from './types';

const DIMENSIONS: HealthDimension[] = [
  'correctness', 'freshness', 'metadata', 'semantic_readiness',
  'conflict', 'stability', 'quality',
];
const SEVERITY_RANK: Record<VerifyIssue['severity'], number> = { info: 0, warning: 1, error: 2 };

/**
 * Additive v1.3.3 health lenses. These intentionally do not rewrite an
 * issue's historical dimension: legacy scores and baselines remain stable,
 * while JSON consumers get dedicated conflict/stability/quality views.
 */
const EXTENDED_DIMENSION_TYPES: Record<Exclude<HealthDimension, 'correctness' | 'freshness' | 'metadata' | 'semantic_readiness'>, ReadonlySet<string>> = {
  conflict: new Set(['conflicting_classifications', 'contradictory_memory', 'conflict', 'conflicts_with']),
  stability: new Set(['stale_memory', 'stale_index', 'memory_dirty', 'stale_next_step', 'active_lock', 'stale_lock', 'missing_database']),
  quality: new Set([
    'card_too_large', 'card_too_large_relaxed', 'low_confidence', 'too_many_relations',
    'orphan_edges', 'missing_contract_field', 'unclassified_card', 'untrusted_memory',
    'unclassified_sensitivity', 'invalid_trust_label', 'untrusted_content',
    'untracked_card', 'missing_source_file',
  ]),
};

export function issueFingerprint(issue: VerifyIssue): string {
  const scope = issue.card_id ?? 'global';
  return `${issue.type}:${scope}`;
}

export function aggregateHealthIssues(input: readonly VerifyIssue[]): VerifyIssue[] {
  const byFingerprint = new Map<string, VerifyIssue>();
  for (const raw of input) {
    const dimension = raw.dimension ?? healthRule(raw.type).dimension;
    const fingerprint = raw.fingerprint ?? issueFingerprint(raw);
    const paths = new Set([...(raw.file_paths ?? []), ...(raw.file_path ? [raw.file_path] : [])]);
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, {
        ...raw,
        dimension,
        fingerprint,
        evidence_count: raw.evidence_count ?? Math.max(1, paths.size),
        file_paths: paths.size ? [...paths].sort() : undefined,
      });
      continue;
    }
    for (const value of paths) {
      const merged = new Set(existing.file_paths ?? []);
      merged.add(value);
      existing.file_paths = [...merged].sort();
    }
    existing.evidence_count = (existing.evidence_count ?? 1) + (raw.evidence_count ?? 1);
    if (SEVERITY_RANK[raw.severity] > SEVERITY_RANK[existing.severity]) existing.severity = raw.severity;
  }
  return [...byFingerprint.values()].sort((a, b) => (a.fingerprint ?? '').localeCompare(b.fingerprint ?? ''));
}

function scoreIssues(issues: readonly VerifyIssue[]): number {
  const counts = new Map<string, { severity: VerifyIssue['severity']; count: number }>();
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const key = `${issue.dimension}:${issue.type}`;
    const current = counts.get(key);
    if (!current) counts.set(key, { severity: issue.severity, count: 1 });
    else {
      current.count++;
      if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[current.severity]) current.severity = issue.severity;
    }
  }
  let penalty = 0;
  for (const { severity, count } of counts.values()) {
    const base = severity === 'error' ? 30 : 5;
    const cap = severity === 'error' ? 100 : 20;
    penalty += Math.min(cap, base * (1 + Math.log2(count)));
  }
  return Math.max(0, Math.round(100 - penalty));
}

function issuesForExtendedDimension(
  issues: readonly VerifyIssue[],
  dimension: 'conflict' | 'stability' | 'quality',
): VerifyIssue[] {
  const types = EXTENDED_DIMENSION_TYPES[dimension];
  return issues.filter(issue => {
    if (types.has(issue.type)) return true;
    // Keep the quality lens extensible for future metadata rules while
    // reserving explicitly classified conflict/stability signals for their
    // dedicated dimensions.
    if (dimension !== 'quality' || issue.dimension !== 'metadata') return false;
    return !EXTENDED_DIMENSION_TYPES.conflict.has(issue.type)
      && !EXTENDED_DIMENSION_TYPES.stability.has(issue.type);
  });
}

export function buildVerifyResult(
  rawIssues: readonly VerifyIssue[],
  baseline: HealthBaselineFile | null,
  baselineStatus: HealthBaselineSummary['status'],
  baselinePath: string,
  semanticReadiness: SemanticReadinessSummary = {
    applicable: false,
    eligible_cards: 0,
    excluded_cards: 0,
    excluded_by_reason: {},
    pipeline_version: null,
    index_compatible: false,
    index_fresh: false,
  },
): VerifyResult {
  const issues = aggregateHealthIssues(rawIssues);
  const baselineById = new Map((baseline?.entries ?? []).map(entry => [entry.fingerprint, entry]));
  let historical = 0;
  let fresh = 0;
  for (const issue of issues) {
    const prior = baselineById.get(issue.fingerprint!);
    issue.historical = !!prior
      && SEVERITY_RANK[prior.severity] >= SEVERITY_RANK[issue.severity]
      && prior.evidence_count >= (issue.evidence_count ?? 1);
    issue.historical ? historical++ : fresh++;
  }
  const currentIds = new Set(issues.map(issue => issue.fingerprint!));
  const resolved = baseline ? baseline.entries.filter(entry => !currentIds.has(entry.fingerprint)).length : 0;
  const dimensions = {} as Record<HealthDimension, HealthDimensionResult>;
  for (const dimension of DIMENSIONS) {
    const applicable = dimension !== 'semantic_readiness' || semanticReadiness.applicable;
    const selected = dimension === 'conflict' || dimension === 'stability' || dimension === 'quality'
      ? issuesForExtendedDimension(issues, dimension)
      : issues.filter(issue => issue.dimension === dimension);
    dimensions[dimension] = {
      status: applicable ? 'applicable' : 'not_applicable',
      score: applicable ? scoreIssues(selected) : null,
      issue_count: selected.length,
    };
  }
  const overallScore = scoreIssues(issues.filter(issue => issue.dimension !== 'semantic_readiness' || semanticReadiness.applicable));
  const newIssues = baseline ? issues.filter(issue => !issue.historical) : [];
  const changeScore = baseline ? scoreIssues(newIssues) : null;
  return {
    passed: !issues.some(issue => issue.severity === 'error'),
    score: overallScore,
    overall_score: overallScore,
    change_score: changeScore,
    dimensions,
    semantic_readiness: semanticReadiness,
    baseline: { status: baselineStatus, path: baselinePath, historical, new: fresh, resolved },
    issues,
  };
}
