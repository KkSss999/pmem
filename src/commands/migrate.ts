import * as path from 'path';
import { loadManifest, saveManifest, getDefaultManifest } from '../core/manifest';
import { ensureDir, copyFile, readFile, writeFile, atomicWrite, listFiles } from '../core/fs';
import { Manifest, MigrationRecord } from '../types';

const PMEM_DIR = '.pmem';

export function migrateCommand(options: { to?: string; dryRun?: boolean; backup?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);
  const manifest = loadManifest(pmemPath);

  if (!manifest) {
    console.log('No .pmem/manifest.yml found. Run `pmem init` first.');
    return;
  }

  const currentSchema = manifest.pmem?.schema_version || '0.1';
  const targetSchema = options.to || '0.2';

  if (currentSchema === targetSchema) {
    console.log(`Project is already at schema version ${currentSchema}. No migration needed.`);
    return;
  }

  if (options.dryRun) {
    dryRunMigration(pmemPath, manifest, currentSchema, targetSchema);
    return;
  }

  // Backup before migration
  if (options.backup !== false) {
    createBackup(pmemPath, currentSchema);
  }

  // Execute migration
  executeMigration(pmemPath, manifest, currentSchema, targetSchema);
}

function dryRunMigration(pmemPath: string, manifest: Manifest, from: string, to: string): void {
  console.log(`Migration plan: ${from} -> ${to}\n`);

  if (from === '0.1' && to === '0.2') {
    console.log('Manifest changes:');
    console.log('  - Replace version + pmem_version with pmem.schema_version block');
    console.log('  - Add memory_status fields');
    console.log('  - Add card_policy fields');
    console.log('  - Add concurrency.mode + lock config');
    console.log('  - Add distill config');
    console.log('  - Add migrations.applied history');
    console.log('');
    console.log('Card changes:');
    console.log('  - Add schema_version: "0.2" to all card frontmatter');
    console.log(`  - (${countCards(pmemPath)} cards will be updated)`);
    console.log('');
    console.log('Indexes:');
    console.log('  - Will rebuild all indexes');
    console.log('');
    console.log('No files changed. Run without --dry-run to apply.');
  } else {
    console.log(`No migration path defined for ${from} -> ${to}.`);
  }
}

function executeMigration(pmemPath: string, manifest: Manifest, from: string, to: string): void {
  if (from === '0.1' && to === '0.2') {
    // Upgrade manifest to v0.2
    const projectName = manifest.project?.name || path.basename(process.cwd());
    const newManifest = getDefaultManifest(projectName, 'minimal');

    // Preserve user-customized fields from old manifest
    if (manifest.project?.name) newManifest.project.name = manifest.project.name;
    if (manifest.integrations?.active) newManifest.integrations.active = manifest.integrations.active;

    // Record migration
    const migrationRecord: MigrationRecord = {
      id: `core-${from}-to-${to}`,
      applied_at: new Date().toISOString(),
      cli_version: '0.2.0',
    };
    newManifest.migrations.applied = [migrationRecord];
    newManifest.pmem.last_migrated_by = '0.2.0';

    saveManifest(pmemPath, newManifest);

    // Add schema_version to all existing cards
    addSchemaVersionToCards(pmemPath);

    console.log(`✓ Migration ${from} -> ${to} completed.`);
    console.log('  Run `pmem rebuild` to update indexes.');
  } else {
    console.log(`No migration path defined for ${from} -> ${to}.`);
  }
}

function createBackup(pmemPath: string, fromVersion: string): void {
  const dateStr = new Date().toISOString().split('T')[0];
  const backupDir = path.join(pmemPath, 'backups', `${dateStr}-before-v0.2`);
  ensureDir(backupDir);

  // Copy manifest
  const manifestSrc = path.join(pmemPath, 'manifest.yml');
  const manifestDst = path.join(backupDir, 'manifest.yml');
  copyFile(manifestSrc, manifestDst);

  console.log(`✓ Backup created at ${backupDir}`);
}

function addSchemaVersionToCards(pmemPath: string): void {
  const cardFiles = listFiles(pmemPath, /\.md$/);
  let updated = 0;

  for (const file of cardFiles) {
    // Skip files in backups/, indexes/, integrations/
    if (file.includes('/backups/') || file.includes('/indexes/') || file.includes('/integrations/')) continue;

    let content = readFile(file);
    if (!content) continue;

    // Check if card has frontmatter (starts with ---)
    if (content.startsWith('---')) {
      const endIdx = content.indexOf('---', 4);
      if (endIdx > 0) {
        const frontmatter = content.substring(4, endIdx);
        // Only add if doesn't already have schema_version
        if (!frontmatter.includes('schema_version:')) {
          content = content.substring(0, 4) + 'schema_version: "0.2"\n' + content.substring(4);
          atomicWrite(file, content);
          updated++;
        }
      }
    }
  }

  if (updated > 0) {
    console.log(`  Added schema_version to ${updated} cards.`);
  }
}

function countCards(pmemPath: string): number {
  const cardFiles = listFiles(pmemPath, /\.md$/);
  return cardFiles.filter(f =>
    !f.includes('/backups/') && !f.includes('/indexes/') && !f.includes('/integrations/')
  ).length;
}
