import * as path from 'path';
import { execSync } from 'child_process';
import { fileExists, ensureDir, atomicWrite } from '../core/fs';
import { loadManifest, resolveConfig, saveManifest } from '../core/manifest';
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

  const versionClean = version.replace(/^v/, '');
  const milestoneId = `milestone.v${versionClean}`;

  const message = options.message || `Released version ${version}`;
  const tag = options.tag || `v${versionClean}`;

  // Check if git tag exists
  let gitInfo = '';
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore', encoding: 'utf8' }).trim();
    if (gitDir) {
      try {
        const tagSha = execSync(`git rev-parse refs/tags/${tag}`, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
        gitInfo = `\n## Git Tag\n- Tag: \`${tag}\`\n- Commit: \`${tagSha.slice(0, 8)}\``;
      } catch {
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
created: ${new Date().toISOString().split('T')[0]}
tags: [release, ${tag}]
---

# Milestone: ${version}

## What
${message}

## When
Released ${new Date().toISOString().split('T')[0]}.
${gitInfo}
## Next
Continue development toward the next milestone.
`);

  console.log(`Milestone recorded: ${path.relative(cwd, milestoneFile)}`);
  console.log(`  Version: ${version}`);
  console.log(`  ID: ${milestoneId}`);

  // Register 'milestone' in manifest if not already present (review item #3)
  registerMilestoneType(manifest, config, pmemPath);

  // Index the card and link to related feature cards
  let didRebuild = false;
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (fileExists(dbPath)) {
    try {
      const db = openDatabase(pmemPath);
      createSchema(db);

      // Rebuild to index the new card
      const { rebuildCommand } = require('./rebuild');
      rebuildCommand({ card: milestoneId });
      didRebuild = true;

      // Link to feature cards whose ID contains the version (tightened: match
      // `feature.v<version>` prefix or `v<version_underscored>` segment).
      const versionUnderscored = versionClean.replace(/\./g, '_');
      const featureCards = db.prepare(
        `SELECT id FROM cards
         WHERE type = 'feature'
           AND (id LIKE ? OR id LIKE ?)
           AND is_deleted = 0`
      ).all(
        `feature.v${versionClean}%`,
        `%v${versionUnderscored}%`
      ) as Array<{ id: string }>;

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

  // Only suggest a manual rebuild when the DB path didn't already do one (review item #4)
  if (!didRebuild) {
    console.log(`\nRun \`pmem rebuild\` to index the new milestone card.`);
  }
  process.exit(0);
}

/**
 * Ensure 'milestone' is registered in the manifest's card type whitelist
 * so that verify / rebuild don't produce card_id_violation warnings.
 */
function registerMilestoneType(manifest: any, config: any, pmemPath: string): void {
  let changed = false;

  // v0.7.0+ projects: add to schema.card_types
  if (manifest.schema && Array.isArray(manifest.schema.card_types)) {
    if (!manifest.schema.card_types.includes('milestone')) {
      manifest.schema.card_types.push('milestone');
      changed = true;
    }
    // Also add type_dirs entry if missing
    if (!manifest.schema.type_dirs) {
      manifest.schema.type_dirs = {};
    }
    if (!manifest.schema.type_dirs['milestone']) {
      manifest.schema.type_dirs['milestone'] = 'traces';
      changed = true;
    }
  }

  // v0.6.x projects: add milestone to id_pattern alternation
  if (manifest.card_policy?.id_pattern) {
    const pattern: string = manifest.card_policy.id_pattern;
    if (!pattern.includes('milestone')) {
      // Insert milestone before the closing parenthesis of the type alternation
      manifest.card_policy.id_pattern = pattern.replace(
        /(\([^)]+)\)/,
        '$1|milestone)'
      );
      changed = true;
    }
  }

  if (changed) {
    saveManifest(pmemPath, manifest);
    console.log('  Registered "milestone" type in manifest.');
  }
}
