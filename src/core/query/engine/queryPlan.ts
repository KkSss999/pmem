import type { ParsedIntent } from './intent';

export interface QueryPlan {
  raw: string;
  normalized: string;
  terms: string[];
  /** Terms with enough local lexical context for deterministic reranking. */
  lexicalTerms: string[];
  exactAnchors: string[];
  preferredTypes: string[];
  /** A narrow shape used to prioritize real graph evidence for factual questions. */
  shape: QueryShape;
}

export type QueryShape = 'general' | 'factual_relation';

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
    lexicalTerms: lexicalTerms(intent.raw, intent.tokens),
    exactAnchors: [...new Set([...intent.cardIdCandidates, ...intent.pathCandidates])],
    preferredTypes: [...new Set(preferredTypes)],
    shape: isFactualRelationQuery(intent.raw) ? 'factual_relation' : 'general',
  };
}

/**
 * Keep CJK query evidence deterministic without treating every common
 * character as an equally strong keyword. ASCII tokens stay whole; CJK runs
 * contribute their phrase and overlapping bigrams, which is useful for names
 * and relation verbs without inventing synonyms.
 */
function lexicalTerms(raw: string, tokens: readonly string[]): string[] {
  const terms: string[] = tokens.filter(term => !/[一-鿿]/.test(term) && term.length >= 2);
  const runs = raw.toLowerCase().match(/[一-鿿]+/g) ?? [];
  for (const run of runs) {
    if (run.length >= 2) terms.push(run);
    for (let index = 0; index + 1 < run.length; index++) {
      terms.push(run.slice(index, index + 2));
    }
  }
  return [...new Set(terms)];
}

function isFactualRelationQuery(raw: string): boolean {
  const hasQuestionWord = /(?:谁|何人|什么|哪(?:个|些)|何时|哪里|为何|为什么|who|what|which|when|where|why)/i.test(raw);
  if (!hasQuestionWord) return false;
  // This is deliberately a query-shape check, not an edge-type mapper. The
  // graph remains the only source of relation evidence.
  return /(?:击败|击杀|打败|击退|负责|属于|依赖|关联|连接|引用|来自|拥有|包含|对手|defeat|beat|kill|own|belong|depend|relat|connect|refer)/i.test(raw);
}
