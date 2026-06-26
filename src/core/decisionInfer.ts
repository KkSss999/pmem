import * as path from 'path';
import * as fs from 'fs';
import { parseTraceCard } from './traceParse';
import { fileExists, readFile, ensureDir, atomicWrite } from './fs';

export interface InferredDecision {
  id: string;
  title: string;
  statement: string;
  reason: string;
  evidence: string[]; // trace card IDs
  related: string[];
  source_files: string[];
}

export function inferDecisions(pmemPath: string): InferredDecision[] {
  const traceDir = path.join(pmemPath, 'traces');
  if (!fileExists(traceDir)) return [];

  const decisions: InferredDecision[] = [];

  try {
    const traceFiles = fs.readdirSync(traceDir)
      .filter(f => f.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b)); // Chronological order

    for (const file of traceFiles) {
      const filePath = path.join(traceDir, file);
      const content = readFile(filePath);
      if (!content) continue;

      const parsed = parseTraceCard(content);
      if (!parsed || !parsed.decisions || parsed.decisions.length === 0) continue;

      for (const dec of parsed.decisions) {
        if (dec === '(none)') continue;

        // Generate slug from decision statement
        const slug = dec
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 40);

        const id = `decision.${slug}`;

        // Look for existing
        let existing = decisions.find(d => d.id === id);
        if (existing) {
          if (!existing.evidence.includes(parsed.id)) {
            existing.evidence.push(parsed.id);
          }
        } else {
          // Uniquify title from decision statement
          let title = dec.charAt(0).toUpperCase() + dec.slice(1);
          if (title.length > 50) {
            title = title.slice(0, 47) + '...';
          }

          decisions.push({
            id,
            title,
            statement: dec,
            reason: `Inferred from trace ${parsed.id}`,
            evidence: [parsed.id],
            related: parsed.changedFiles
              .filter(f => f.includes('App') || f.includes('engine') || f.includes('render'))
              .map(f => {
                if (f.toLowerCase().includes('engine')) return 'module.engine';
                if (f.toLowerCase().includes('render')) return 'module.renderer';
                return 'module.ui';
              }),
            source_files: parsed.changedFiles
          });
        }
      }
    }
  } catch {}

  // Deduplicate related modules
  for (const d of decisions) {
    d.related = Array.from(new Set(d.related));
  }

  return decisions;
}

export function writeInferredDecisions(pmemPath: string, decisions: InferredDecision[]): string[] {
  const writtenPaths: string[] = [];
  const decisionsDir = path.join(pmemPath, 'decisions');
  ensureDir(decisionsDir);

  for (const d of decisions) {
    const filename = `${d.id}.md`;
    const filePath = path.join(decisionsDir, filename);

    const content = `---
id: ${d.id}
type: decision
status: active
tags:
  - inferred
updated: "${new Date().toISOString()}"
related:
${d.related.map(r => `  - ${r}`).join('\n')}
source_files:
${d.source_files.map(sf => `  - ${sf}`).join('\n')}
---

# ${d.title}

## Decision
${d.statement}

## Reason
${d.reason}

## Impact
- Renderer and logic bounds depend on this decision.
- Project implementations must align with this choice.

## Evidence
${d.evidence.map(e => `- [[${e}]]`).join('\n')}
`;

    atomicWrite(filePath, content);
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}

export function writeDecisionCandidates(pmemPath: string, decisions: InferredDecision[]): string {
  const candidatesDir = path.join(pmemPath, 'candidates');
  ensureDir(candidatesDir);
  const filePath = path.join(candidatesDir, 'decisions.generated.md');

  const content = `# Generated Decision Candidates

Generated on ${new Date().toISOString().split('T')[0]}.

## Candidates
${decisions.map(d => `### ${d.title}
- Suggested ID: ${d.id}
- Statement: ${d.statement}
- Evidence: ${d.evidence.join(', ')}
- Related: ${d.related.join(', ')}
`).join('\n')}

Run \`pmem decision infer --write\` to finalize these decision cards.
`;

  atomicWrite(filePath, content);
  return filePath;
}
