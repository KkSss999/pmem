export interface ParsedIntent {
  raw: string;
  normalized: string;
  tokens: string[];
  /** Tokens that look like card ids, e.g. decision.foo_bar_20260101 */
  cardIdCandidates: string[];
  /** Tokens that look like file paths, e.g. src/core/db.ts */
  pathCandidates: string[];
  /** Card type names mentioned in the query (decision, module, ...) */
  typeHints: string[];
  /** Inventory-style request such as “有哪些角色” or “list all chapters”. */
  enumeration: boolean;
}

const CARD_ID_RE = /^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/;
const PATH_RE = /^[\w.@-]+(\/[\w.@-]+)+$|^[\w-]+\.(ts|js|tsx|jsx|py|rs|go|java|c|h|cpp|hpp|md|yml|yaml|json|toml)$/;
const ENUMERATION_RE = /\b(list|listing|browse|show|display|enumerate|every|all|what(?:'s| is| are))\b/i;
const ENUMERATION_CJK_RE = /列出|列表|浏览|查看|显示|枚举|所有|全部|有哪些|哪些/;
const TYPE_ALIASES: Record<string, readonly string[]> = {
  character: ['character', 'characters', '角色', '人物', '角色卡'],
  chapter: ['chapter', 'chapters', '章节', '章节卡'],
  world: ['world', 'worlds', '世界', '世界观'],
  arc: ['arc', 'arcs', '故事线', '剧情线'],
  module: ['module', 'modules', '模块'],
  decision: ['decision', 'decisions', '决策'],
  feature: ['feature', 'features', '功能'],
  task: ['task', 'tasks', '任务'],
  trace: ['trace', 'traces', '记录', '变更记录'],
  risk: ['risk', 'risks', '风险'],
  source: ['source', 'sources', '来源'],
  claim: ['claim', 'claims', '断言'],
  note: ['note', 'notes', '笔记'],
  experiment: ['experiment', 'experiments', '实验'],
};

export function parseIntent(query: string, knownTypes: string[]): ParsedIntent {
  const raw = query;
  const normalized = query.toLowerCase().trim();
  const tokens = tokenize(normalized);

  const cardIdCandidates: string[] = [];
  const pathCandidates: string[] = [];
  const typeHints: string[] = [];

  const rawWords = normalized.split(/\s+/).filter(Boolean);
  for (const word of rawWords) {
    if (CARD_ID_RE.test(word)) cardIdCandidates.push(word);
    else if (PATH_RE.test(word)) pathCandidates.push(word);
  }

  for (const type of knownTypes) {
    const aliases = TYPE_ALIASES[type] ?? [type, type.endsWith('s') ? type.slice(0, -1) : `${type}s`];
    if (aliases.some(alias => {
      if (/^[一-鿿]/.test(alias)) return normalized.includes(alias);
      return tokens.includes(alias.toLowerCase());
    })) {
      typeHints.push(type);
    }
  }

  return {
    raw,
    normalized,
    tokens,
    cardIdCandidates: [...new Set(cardIdCandidates)],
    pathCandidates: [...new Set(pathCandidates)],
    typeHints: [...new Set(typeHints)],
    enumeration: typeHints.length > 0 && (ENUMERATION_RE.test(raw) || ENUMERATION_CJK_RE.test(raw)),
  };
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const words = text.split(/[\s,，。、；;：:！!？?()（）\[\]【】{}]+/);
  for (const word of words) {
    if (word.length === 0) continue;
    if (/[一-鿿]/.test(word)) {
      const cjkChars = word.match(/[一-鿿]/g) || [];
      tokens.push(...cjkChars);
      const nonCjk = word.replace(/[一-鿿]/g, '').trim();
      if (nonCjk) tokens.push(nonCjk.toLowerCase());
    } else {
      tokens.push(word.toLowerCase());
    }
  }
  return [...new Set(tokens)];
}
