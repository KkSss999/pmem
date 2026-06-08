import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, ensureDir, atomicWrite } from '../core/fs';
import { loadManifest, resolveConfig } from '../core/manifest';
import { openDatabase, createSchema, closeDatabase, insertEdge } from '../core/db';

const PMEM_DIR = '.pmem';

export function milestoneCommand(version: string, options: { message?: string; tag?: string } = {}): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    process.exit(2);
  }

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    console.log('No manifest found. Run `pmem init` first.');
    process.exit(2);
  }

  const config = resolveConfig(manifest);

  // Determine the directory for milestone/trace cards
  const traceDirName = config.type_dirs['trace'] || config.type_dirs['milestone'] || 'traces';
  const traceDir = path.join(pmemPath, traceDirName);
  ensureDir(traceDir);

  const today = new Date().toISOString().split('T')[0];
  const milestoneId = `milestone.v${version.replace(/^v/, '')}`;

  const message = options.message || `Released version ${version}`;
  const tag = options.tag || `v${version.replace(/^v/, '')}`;

  // Check if git tag exists
  let gitInfo = '';
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore', encoding: 'utf8' }).trim();
    if (gitDir) {
      try {
        const tagSha = execSync(`git rev-parse refs/tags/${tag}`, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
        gitInfo = `\n## Git Tag\n- Tag: \`${tag}\`\n- Commit: \`${tagSha.slice(0, 8)}\``;
      } catch {
        // Tag doesn't exist yet — record the current HEAD instead
        try {
          const headSha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
          gitInfo = `\n## Git\n- HEAD: \`${headSha.slice(0, 8)}\`\n- Tag \`${tag}\` not yet created (use \`git tag ${tag}\` to create it)`;
        } catch {
          // no git info available
        }
      }
    }
  } catch {
    // not a git repo
  }

  const milestoneFile = path.join(traceDir, `milestone.${milestoneId}.md`);

  if (fileExists(milestoneFile)) {
    console.log(`Milestone card already exists: ${path.relative(cwd, milestoneFile)}`);
    console.log(`  Edit it directly or use a different version.`);
    process.exit(2);
  }

  atomicWrite(milestoneFile, `---
id: ${milestoneId}
type: milestone
status: shipped
created: ${today}
tags: [release, ${tag}]
---

# Milestone: ${version}

## What
${message}

## When
Released ${today}.
${gitInfo}
## Next
Continue development toward the next milestone.
`);

  console.log(`Milestone recorded: ${path.relative(cwd, milestoneFile)}`);
  console.log(`  Version: ${version}`);
  console.log(`  ID: ${milestoneId}`);

  // Also create edges to relevant cards if DB exists
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      const db = openDatabase(pmemPath);
      createSchema(db);

      // Rebuild to index the new card
      const { rebuildCommand } = require('./rebuild');
      rebuildCommand({ card: milestoneId });

      // Link to feature cards that match this version
      const featureCards = db.prepare(
        "SELECT id FROM cards WHERE type = 'feature' AND id LIKE ? AND is_deleted = 0"
      ).all(`%${version.replace(/^v/, '')}%`) as Array<{ id: string }>;

      const now = new Date().toISOString();
      for (const fc of featureCards) {
        insertEdge(db, {
          from_id: milestoneId,
          to_id: fc.id,
          type: 'implements',
          source: 'inferred',
          confidence: 0.9,
          created_at: now,
          updated_at: now,
        });
      }
      if (featureCards.length > 0) {
        console.log(`  Linked to ${featureCards.length} feature card(s): ${featureCards.map(f => f.id).join(', ')}`);
      }

      closeDatabase();
    } catch {
      // DB operations are best-effort
    }
  }

  console.log(`\nRun \`pmem rebuild\` to index the new milestone card.`);
  process.exit(0);
}
