import type { HealthDimension } from '../../types';
import type { HealthIssueRule } from './types';

const FRESHNESS = new Set([
  'stale_memory', 'stale_index', 'memory_dirty', 'stale_next_step',
]);
const METADATA = new Set([
  'card_id_violation', 'card_too_large', 'card_too_large_relaxed',
  'too_many_relations', 'low_confidence', 'unclassified_card',
  'untrusted_memory', 'unclassified_sensitivity', 'secret_memory',
  'invalid_trust_label',
  'missing_contract_field', 'untracked_card', 'conflicting_classifications',
  'agent_only_decision',
]);

export function healthRule(type: string): HealthIssueRule {
  let dimension: HealthDimension = 'correctness';
  if (FRESHNESS.has(type)) dimension = 'freshness';
  else if (METADATA.has(type)) dimension = 'metadata';
  else if (type.startsWith('semantic_')) dimension = 'semantic_readiness';
  return { dimension, aggregation: type === 'stale_memory' ? 'card' : 'global' };
}
