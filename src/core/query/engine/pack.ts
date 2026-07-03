export type RecallMode = 'brief' | 'normal' | 'deep';

export interface PackItemL2 {
  id: string;
  title: string;
  summary?: string;
  score?: number;
  reasons?: string[];
  stale?: boolean;
  file_path: string;
}

export interface PackInput {
  l0: string[];            // project one-liner, stage, focus, next — never trimmed
  l1: string[];            // foundation/decision compressed summaries
  l2: PackItemL2[];        // query-relevant card summaries, sorted by score desc
  l3: string[];            // read-if-needed paths
}

export interface PackOptions {
  budget: number;          // approx token budget
  mode?: RecallMode;
}

export interface PackedOutput {
  lines: string[];
  dropped_l2: number;
  trimmed: boolean;
}

const L2_LIMIT: Record<RecallMode, number> = { brief: 0, normal: 10, deep: 25 };

/** Rough token estimate: CJK chars count 1, else ~4 chars/token. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

/**
 * Layered budget packing. Trim order: L2 low-score items → L2 summaries to
 * one line → L1 → L3 tail. L0 is never trimmed.
 */
export function pack(input: PackInput, opts: PackOptions): PackedOutput {
  const mode = opts.mode ?? 'normal';
  const l2Limit = L2_LIMIT[mode];

  const l0Lines = input.l0;
  let l1Lines = [...input.l1];
  let l2Items = input.l2.slice(0, l2Limit);
  let l3Lines = [...input.l3];

  const droppedByMode = input.l2.length - l2Items.length;

  const render = (l2WithSummary: boolean): string[] => {
    const lines: string[] = [...l0Lines];
    if (l1Lines.length > 0) lines.push('', ...l1Lines);
    if (l2Items.length > 0) {
      lines.push('');
      for (const item of l2Items) {
        const score = item.score !== undefined ? ` (${item.score})` : '';
        const reasons = item.reasons && item.reasons.length > 0 ? ` [${item.reasons.join(', ')}]` : '';
        const stale = item.stale ? ' ⚠stale' : '';
        lines.push(`- ${item.id}${score}${reasons}${stale}`);
        if (l2WithSummary && item.summary) lines.push(`  ${item.summary}`);
      }
    }
    if (l3Lines.length > 0) {
      lines.push('', 'READ_IF_NEEDED:');
      for (const p of l3Lines) lines.push(`  ${p}`);
    }
    return lines;
  };

  const fits = (lines: string[]) => estimateTokens(lines.join('\n')) <= opts.budget;

  let trimmed = false;
  let dropped = droppedByMode;

  // Attempt 1: full render
  let lines = render(true);
  if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };

  trimmed = true;

  // Step 1: drop L2 items from the bottom (lowest score last in sorted input)
  while (l2Items.length > 0) {
    lines = render(true);
    if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };
    l2Items = l2Items.slice(0, -1);
    dropped++;
  }
  // restore minimal L2 view: top items without summaries
  l2Items = input.l2.slice(0, Math.min(l2Limit, 5));
  dropped = Math.max(0, input.l2.length - l2Items.length);

  // Step 2: L2 one-line only
  lines = render(false);
  if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };

  while (l2Items.length > 0) {
    l2Items = l2Items.slice(0, -1);
    dropped++;
    lines = render(false);
    if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };
  }

  // Step 3: compress L1
  l1Lines = l1Lines.slice(0, 3);
  lines = render(false);
  if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };
  l1Lines = [];

  // Step 4: trim L3 tail
  while (l3Lines.length > 0) {
    lines = render(false);
    if (fits(lines)) return { lines, dropped_l2: dropped, trimmed };
    l3Lines = l3Lines.slice(0, -1);
  }

  // L0 only — never trimmed regardless of budget
  return { lines: render(false), dropped_l2: dropped, trimmed };
}
