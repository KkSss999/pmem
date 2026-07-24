import type { HealthDimension, VerifyIssue } from '../../types';

export interface HealthIssueRule {
  dimension: HealthDimension;
  aggregation: 'card' | 'global';
}

export interface HealthBaselineEntry {
  fingerprint: string;
  severity: VerifyIssue['severity'];
  dimension: HealthDimension;
  evidence_count: number;
}

export interface HealthBaselineFile {
  schema_version: 1;
  created_at: string;
  project: string;
  entries: HealthBaselineEntry[];
}
