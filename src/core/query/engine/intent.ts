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
}

const CARD_ID_RE = /^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/;
const PATH_RE = /^[\w.@-]+(\/[\w.@-]+)+$|^[\w-]+\.(ts|js|tsx|jsx|py|rs|go|java|c|h|cpp|hpp|md|yml|yaml|json|toml)$/;

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

  for (const t of tokens) {
    if (knownTypes.includes(t)) typeHints.push(t);
  }

  return {
    raw,
    normalized,
    tokens,
    cardIdCandidates: [...new Set(cardIdCandidates)],
    pathCandidates: [...new Set(pathCandidates)],
    typeHints: [...new Set(typeHints)],
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
