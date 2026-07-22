import * as path from 'path';
import { fileExists } from '../core/fs';
import { statusQuery } from '../core/query/status';
import { Pmem } from '../runtime';
import type { CliFormat } from '../types';

// === Data structures ===

interface AffectedCard {
  card_id: string;
  match_type: 'exact' | 'directory' | 'graph_neighbor' | 'new_card' | 'modified_card';
  matched_file?: string;
  matched_dir?: string;
  via_card?: string;
}

function formatAffectedCardDetail(ac: AffectedCard): string {
  switch (ac.match_type) {
    case 'exact':
      return `exact: ${ac.matched_file}`;
    case 'directory':
      return `directory: ${ac.matched_dir}`;
    case 'graph_neighbor':
      return `graph_neighbor via ${ac.via_card}`;
    case 'new_card':
      return `new_card: ${ac.matched_file}`;
    case 'modified_card':
      return `modified_card: ${ac.matched_file}`;
    default:
      return ac.match_type;
  }
}

// Back-compat for syncCommand's legacy internal use. CLI status reads go through
// Pmem Runtime via statusCommand below.
export function getChangedFiles(cwd: string, since?: string) {
  return statusQuery(path.join(cwd, '.pmem'), { since, cwd }).changes.map(c => ({
    path: c.path,
    status: c.status,
    relatedCards: c.related_cards.map(rc => ({ card_id: rc.card_id, match_type: rc.match_type })),
  }));
}

// === Main command ===

export async function statusCommand(options: { since?: string; format?: string }): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');
  const format = (options.format || 'compact') as CliFormat;

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  let pmem: Pmem | null = null;
  const result = await (async () => {
    try {
      pmem = await Pmem.open({ root: cwd });
      return await pmem.status({ since: options.since });
    } finally {
      if (pmem) await pmem.close();
    }
  })();

  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // compact output
    console.log(`Changed files (${result.changes.length}) [${result.source}]:`);
    for (const c of result.changes) {
      const related = c.related_cards.length > 0
        ? c.related_cards.map(rc => `${rc.card_id} (${rc.match_type})`).join(', ')
        : '(no related cards)';
      console.log(`  ${c.status} ${c.path} → related: ${related}`);
    }
    if (result.affected_cards.length > 0) {
      console.log(`\nAffected cards (${result.affected_cards.length}):`);
      for (const ac of result.affected_cards) {
        console.log(`  ${ac.card_id} (${formatAffectedCardDetail(ac as AffectedCard)})`);
      }
      if (result.needs_rebuild) {
        console.log(`\nNote: detected new/modified .pmem/**/*.md files. Run \`pmem rebuild\` to update SQLite indexes.`);
        console.log(`\nRun: pmem rebuild`);
      } else {
        console.log(`\nRun: pmem mark-dirty --auto`);
      }
    }
  }

  // Exit code: always 0 for normal operation.
  // Exit 1 no longer used as "no changes" workflow signal (v0.6.2).
  // Exit 2 reserved for runtime errors (missing DB, corrupt files, etc.).
}
