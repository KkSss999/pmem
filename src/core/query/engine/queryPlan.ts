import type { ParsedIntent } from './intent';

export interface QueryPlan {
  raw: string;
  normalized: string;
  terms: string[];
  exactAnchors: string[];
  preferredTypes: string[];
}

const TYPE_INTENT_RULES: ReadonlyArray<{ pattern: RegExp; types: readonly string[] }> = [
  { pattern: /\b(debug|bug|error|fail|incident|regression|diagnos)|故障|报错|失败|排查|修复/i, types: ['trace', 'risk', 'module'] },
  { pattern: /\b(implement|build|develop|refactor|change|feature)|实现|开发|重构|改造|功能/i, types: ['module', 'decision', 'task', 'feature'] },
  { pattern: /\b(decide|decision|why|rationale|tradeoff)|决策|原因|为什么|取舍/i, types: ['decision', 'risk'] },
  { pattern: /\b(plan|roadmap|next|todo|milestone)|计划|路线图|下一步|待办|里程碑/i, types: ['task', 'feature', 'decision'] },
  { pattern: /\b(verify|test|accept|quality|benchmark)|验证|测试|验收|质量|基准/i, types: ['trace', 'task', 'risk'] },
];

/**
 * Deterministic query planning only: preserve the raw multilingual query for
 * E5 and derive non-generative anchors/features for the local reranker.
 */
export function buildQueryPlan(intent: ParsedIntent): QueryPlan {
  const preferredTypes: string[] = [...intent.typeHints];
  for (const rule of TYPE_INTENT_RULES) {
    if (rule.pattern.test(intent.raw)) preferredTypes.push(...rule.types);
  }
  return {
    raw: intent.raw,
    normalized: intent.normalized,
    terms: intent.tokens.filter(term => term.length > 0),
    exactAnchors: [...new Set([...intent.cardIdCandidates, ...intent.pathCandidates])],
    preferredTypes: [...new Set(preferredTypes)],
  };
}
