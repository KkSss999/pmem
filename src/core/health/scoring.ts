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

const DIMENSIONS: HealthDimension[] = ['correctness', 'freshness', 'metadata', 'semantic_readiness'];
const SEVERITY_RANK: Record<VerifyIssue['severity'], number> = { info: 0, warning: 1, error: 2 };

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
    const selected = issues.filter(issue => issue.dimension === dimension);
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
