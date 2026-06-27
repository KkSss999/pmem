import * as path from 'path';
import { fileExists } from '../core/fs';
import { inferDecisions, writeInferredDecisions, writeDecisionCandidates, InferredDecision, InferredDecisionsDiagnostics } from '../core/decisionInfer';

export interface DecisionInferOptions {
  write?: boolean;
  fromTraces?: boolean;
  format?: 'compact' | 'json';
  threshold?: number;
}

interface NextAction {
  command: string;
  reason: string;
  blocking: boolean;
}

interface DecisionInferJsonOutput {
  command: 'decision infer';
  state: 'no_candidates' | 'candidates_found';
  decisions: InferredDecision[];
  diagnostics: InferredDecisionsDiagnostics;
  next_actions: NextAction[];
  hint: string;
}

const HINT =
  'decision infer scans .pmem/traces/*.md for H2 sections named `## Decision` or `## Decisions`.';

function buildNextActions(state: 'no_candidates' | 'candidates_found'): NextAction[] {
  const actions: NextAction[] = [];
  if (state === 'candidates_found') {
    actions.push({
      command: 'pmem decision infer --write',
      reason: 'Apply inferred decisions as draft cards',
      blocking: false,
    });
  }
  actions.push({
    command: 'pmem capture',
    reason: 'Add more trace cards with explicit `## Decision` sections',
    blocking: false,
  });
  return actions;
}

function printCompactNoCandidates(diagnostics: InferredDecisionsDiagnostics): void {
  console.log('No decisions could be inferred from the current project traces.');
  console.log('');
  console.log('Diagnostics:');
  console.log(`  trace_dir_exists:          ${diagnostics.trace_dir_exists}`);
  console.log(`  traces_scanned:            ${diagnostics.traces_scanned}`);
  console.log(`  traces_with_decisions:     ${diagnostics.traces_with_decisions}`);
  console.log(`  decision_lines_found:      ${diagnostics.decision_lines_found}`);
  console.log(`  candidates_above_threshold:${diagnostics.candidates_above_threshold}`);
  console.log('');
  console.log(`Hint: ${HINT}`);
}

export function decisionInferCommand(options: DecisionInferOptions): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');
  const format = options.format ?? 'compact';

  if (!fileExists(pmemPath)) {
    console.error('Error: No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const result = inferDecisions(pmemPath, { threshold: options.threshold });
  const { decisions, diagnostics } = result;
  const state: 'no_candidates' | 'candidates_found' =
    decisions.length === 0 ? 'no_candidates' : 'candidates_found';

  if (format === 'json') {
    const output: DecisionInferJsonOutput = {
      command: 'decision infer',
      state,
      decisions,
      diagnostics,
      next_actions: buildNextActions(state),
      hint: HINT,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Compact mode (default)
  if (decisions.length === 0) {
    printCompactNoCandidates(diagnostics);
    return;
  }

  if (options.write) {
    const written = writeInferredDecisions(pmemPath, decisions);
    console.log(`Successfully wrote ${written.length} inferred decision card(s):`);
    for (const p of written) {
      console.log(`- ${path.relative(cwd, p)}`);
    }
    console.log('Next: run `pmem rebuild` to rebuild indexes.');
  } else {
    const candidatePath = writeDecisionCandidates(pmemPath, decisions);
    console.log(`Inferred ${decisions.length} decision candidate(s).`);
    console.log(`Candidate list written to: ${path.relative(cwd, candidatePath)}`);
    console.log('Run `pmem decision infer --write` to promote them to formal cards.');
  }
}