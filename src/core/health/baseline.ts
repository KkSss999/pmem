import * as path from 'node:path';
import { atomicWrite, readFile } from '../fs';
import type { VerifyIssue } from '../../types';
import type { HealthBaselineFile } from './types';
import { aggregateHealthIssues } from './scoring';

export const HEALTH_BASELINE_FILE = 'health-baseline.json';

export function healthBaselinePath(pmemPath: string): string {
  return path.join(pmemPath, HEALTH_BASELINE_FILE);
}

export function readHealthBaseline(pmemPath: string): { status: 'missing' | 'loaded' | 'invalid'; value: HealthBaselineFile | null } {
  const raw = readFile(healthBaselinePath(pmemPath));
  if (raw === null) return { status: 'missing', value: null };
  try {
    const value = JSON.parse(raw) as HealthBaselineFile;
    if (
      value.schema_version !== 1 ||
      !Array.isArray(value.entries) ||
      value.project !== path.basename(path.dirname(pmemPath))
    ) throw new Error('invalid schema or project');
    return { status: 'loaded', value };
  } catch {
    return { status: 'invalid', value: null };
  }
}

export function writeHealthBaseline(pmemPath: string, issues: readonly VerifyIssue[], now = new Date()): HealthBaselineFile {
  const value: HealthBaselineFile = {
    schema_version: 1,
    created_at: now.toISOString(),
    project: path.basename(path.dirname(pmemPath)),
    entries: aggregateHealthIssues(issues).map(issue => ({
      fingerprint: issue.fingerprint!,
      severity: issue.severity,
      dimension: issue.dimension!,
      evidence_count: issue.evidence_count ?? 1,
    })),
  };
  atomicWrite(healthBaselinePath(pmemPath), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
