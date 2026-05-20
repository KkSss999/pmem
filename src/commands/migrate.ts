import * as path from 'path';
import { loadManifest, saveManifest, getDefaultManifest, getDefaultManifestV03 } from '../core/manifest';
import { ensureDir, copyFile, readFile, writeFile, atomicWrite, listFiles } from '../core/fs';
import { openDatabase, createSchema, createFTS5, setSchemaVersion, closeDatabase, upsertCard, deleteCardEdges, insertEdge, deleteCardAliases, insertAlias, deleteCardTags, insertTag, deleteCardPaths, insertPath } from '../core/db';
import { computeCardHashes, tokenCount, sectionCount } from '../core/hash';
import { Manifest, ManifestV03, MigrationRecord, CardRow, CardFrontmatter } from '../types';

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
    createBackup(pmemPath, targetSchema);
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
  } else if (from === '0.2' && to === '0.3') {
    dryRunMigration02to03(pmemPath);
  } else {
    console.log(`No migration path defined for ${from} -> ${to}.`);
  }
}

function dryRunMigration02to03(pmemPath: string): void {
  console.log('SQLite changes:');
  console.log('  - Create .pmem/pmem.db with full schema (7 P0 tables + 3 P1 tables)');
  console.log('  - Scan all Markdown cards and populate cards/edges/aliases/tags/paths tables');
  console.log('  - Compute content hashes (file_hash, frontmatter_hash, body_hash)');
  console.log('  - Build FTS5 index if available');
  console.log('');
  console.log('Manifest changes:');
  console.log('  - Update pmem.schema_version: "0.3"');
  console.log('  - Update pmem.protocol_version: "0.3"');
  console.log('  - Add runtime block (mode: sqlite, db_path: .pmem/pmem.db)');
  console.log('  - Add rebuild block (strategy: content_hash)');
  console.log('  - Add cli block (default_format: compact)');
  console.log('  - Add embedding block (enabled: false)');
  console.log('  - Add serve block (enabled: false)');
  console.log('  - Update indexes block (primary: sqlite, legacy_json retained)');
  console.log('');
  console.log('Legacy indexes:');
  console.log('  - indexes/graph.json will be retained (legacy_json.retained: true)');
  console.log('  - indexes/bm25.json will be retained');
  console.log('');
  console.log('Files affected:');
  console.log('  - .pmem/manifest.yml (updated)');
  console.log('  - .pmem/pmem.db (created)');
  console.log('  - .pmem/backups/YYYY-MM-DD-before-v0.3/ (backup)');
  console.log('');
  console.log('No files changed. Run without --dry-run to apply.');
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
  } else if (from === '0.2' && to === '0.3') {
    migrate02to03(pmemPath, manifest);
  } else {
    console.log(`No migration path defined for ${from} -> ${to}.`);
  }
}

// === v0.2 → v0.3 migration ===

function migrate02to03(pmemPath: string, manifest: Manifest): void {
  const db = openDatabase(pmemPath);
  createSchema(db);
  createFTS5(db);
  setSchemaVersion(db, '0.3');

  // Rebuild from Markdown cards into SQLite
  populateSqliteFromCards(pmemPath, db);

  // Build v0.3 manifest
  const projectName = manifest.project?.name || path.basename(process.cwd());
  const newManifest = getDefaultManifestV03(projectName);

  // Preserve user-customized fields from old manifest
  if (manifest.project?.name) newManifest.project.name = manifest.project.name;
  if (manifest.project?.language) newManifest.project.language = manifest.project.language;
  if (manifest.project?.status) newManifest.project.status = manifest.project.status;
  if (manifest.memory_status) newManifest.memory_status = manifest.memory_status;
  if (manifest.card_policy) newManifest.card_policy = manifest.card_policy;
  if (manifest.auto_update) newManifest.auto_update = manifest.auto_update;
  if (manifest.freshness) newManifest.freshness = manifest.freshness;
  if (manifest.concurrency) newManifest.concurrency = manifest.concurrency;
  if (manifest.distill) newManifest.distill = manifest.distill;

  // Carry over integrations (copy full object to preserve registered integrations)
  newManifest.integrations = {
    ...manifest.integrations,
    active: manifest.integrations?.active || [],
  };

  // Set migration metadata
  newManifest.pmem.last_migrated_by = '0.3.0';

  // Carry over existing migrations + append new one
  const existingMigrations = manifest.migrations?.applied || [];
  const migrationRecord: MigrationRecord = {
    id: 'core-0.2-to-0.3',
    applied_at: new Date().toISOString(),
    cli_version: '0.3.0',
  };
  newManifest.migrations.applied = [...existingMigrations, migrationRecord];

  saveManifest(pmemPath, newManifest as any);

  closeDatabase();

  console.log('✓ Migration 0.2 -> 0.3 completed.');
  console.log('  SQLite database created at .pmem/pmem.db');
  console.log('  Manifest updated to v0.3 schema.');
  console.log('  Legacy JSON indexes retained at .pmem/indexes/');
}

function populateSqliteFromCards(pmemPath: string, db: ReturnType<typeof openDatabase>): void {
  const cardFiles = listFiles(pmemPath, /\.md$/);
  const now = new Date().toISOString();
  let cardCount = 0;
  let edgeCount = 0;

  const migrateAll = db.transaction(() => {
    for (const file of cardFiles) {
      // Skip files in backups/, indexes/, integrations/
      if (file.includes('/backups/') || file.includes('/indexes/') || file.includes('/integrations/')) continue;

      const content = readFile(file);
      if (!content) continue;

      const parsed = parseSimpleFrontmatter(content);
      if (!parsed || !parsed.id) continue;

      const id: string = parsed.id;
      const cardType: string = typeof parsed.type === 'string' ? parsed.type : 'module';
      const status: string | null = typeof parsed.status === 'string' ? parsed.status : null;
      const priority: string | null = typeof parsed.priority === 'string' ? parsed.priority : null;
      const schemaVer: string | null = typeof parsed.schema_version === 'string' ? parsed.schema_version : null;
      const cardVer: number = typeof parsed.version === 'number' ? parsed.version : 1;
      const updatedAt: string | null = typeof parsed.updated === 'string' ? parsed.updated : null;
      const lastVerifiedAt: string | null = typeof parsed.last_verified === 'string' ? parsed.last_verified : null;

      // Extract title from first # heading in body
      let title: string = id;
      const titleMatch = parsed.body?.match(/^# (.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // Extract summary from first paragraph after title
      let summary: string | null = null;
      const summaryMatch = parsed.body?.match(/^# .+\n\n(.+)$/m);
      if (summaryMatch) {
        summary = summaryMatch[1].trim().substring(0, 200);
      }

      // Compute hashes
      const fmText = parsed.frontmatterText || '';
      const bodyText = parsed.body || '';
      const hashes = computeCardHashes(content, fmText, bodyText);
      const tCount = tokenCount(content);
      const sCount = sectionCount(bodyText);

      // Determine if candidate card
      const isCandidate = file.includes('/candidates/') ? 1 : 0;

      // Relative path from cwd (consistent with rebuild.ts)
      const relPath = path.relative(process.cwd(), file);

      const cardRow: CardRow = {
        id,
        type: cardType,
        title,
        status,
        priority,
        file_path: relPath,
        summary,
        schema_version: schemaVer,
        card_version: cardVer,
        created_at: now,
        updated_at: updatedAt,
        last_verified_at: lastVerifiedAt,
        file_hash: hashes.fileHash,
        frontmatter_hash: hashes.frontmatterHash,
        body_hash: hashes.bodyHash,
        token_count: tCount,
        section_count: sCount,
        is_deleted: 0,
        is_candidate: isCandidate,
      };

      upsertCard(db, cardRow);

      // Insert edges from depends_on
      const dependsOn: string[] = toArray(parsed.depends_on);
      for (const target of dependsOn) {
        insertEdge(db, {
          from_id: id,
          to_id: target,
          type: 'depends_on',
          source: 'explicit',
          confidence: 1.0,
          created_at: now,
          updated_at: now,
        });
        edgeCount++;
      }

      // Insert edges from related
      const relatedIds: string[] = toArray(parsed.related);
      for (const target of relatedIds) {
        insertEdge(db, {
          from_id: id,
          to_id: target,
          type: 'related_to',
          source: 'explicit',
          confidence: 1.0,
          created_at: now,
          updated_at: now,
        });
        edgeCount++;
      }

      // Insert aliases
      const aliases: string[] = toArray(parsed.aliases);
      for (const alias of aliases) {
        insertAlias(db, id, alias);
      }

      // Insert tags
      const tags: string[] = toArray(parsed.tags);
      for (const tag of tags) {
        insertTag(db, id, tag);
      }

      // Insert paths (source_files from frontmatter)
      const sourceFiles: string[] = toArray(parsed.source_files);
      for (const sf of sourceFiles) {
        insertPath(db, id, sf, 'source');
      }
      // Also register the card's own file
      insertPath(db, id, relPath, 'card_file');

      cardCount++;
    }
  });

  migrateAll();
  console.log(`  Imported ${cardCount} cards, ${edgeCount} edges into SQLite.`);
}

// === Simple frontmatter parser (inlined from rebuild.ts to avoid circular deps) ===

interface ParsedFrontmatter {
  id?: string;
  type?: string;
  status?: string;
  priority?: string;
  schema_version?: string;
  version?: number;
  updated?: string;
  last_verified?: string;
  depends_on?: unknown;
  related?: unknown;
  tags?: unknown;
  aliases?: unknown;
  source_files?: unknown;
  frontmatterText: string;
  body: string;
}

function parseSimpleFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fmText = match[1];
  const body = content.substring(match[0].length);
  const parsed = parseSimpleYaml(fmText);

  return {
    ...parsed,
    frontmatterText: fmText,
    body,
  };
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentArrayKey: string | null = null;
  let currentSubKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === '') continue;

    // Sub-object key: "  key: value"
    const subMatch = line.match(/^  (\w[\w_]*):\s*(.*)/);
    if (subMatch) {
      const key = subMatch[1];
      const val = subMatch[2].trim();
      if (val === '') {
        currentSubKey = key;
        if (!result[currentArrayKey || '']) (result[currentArrayKey || ''] as any) = {};
        continue;
      }
      if (currentArrayKey) {
        if (!result[currentArrayKey]) (result[currentArrayKey] as any) = {};
        (result[currentArrayKey] as Record<string, unknown>)[key] = parseYamlValue(val);
      } else {
        result[key] = parseYamlValue(val);
      }
      continue;
    }

    // Array item: "  - value"
    const arrMatch = line.match(/^  -\s*(.*)/);
    if (arrMatch) {
      const val = arrMatch[1].trim();
      const arrKey = currentSubKey || currentArrayKey;
      if (arrKey) {
        if (!result[arrKey]) (result[arrKey] as any) = [];
        (result[arrKey] as string[]).push(val);
      }
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (topMatch) {
      const key = topMatch[1];
      const val = topMatch[2].trim();
      if (val === '') {
        currentArrayKey = key;
        currentSubKey = null;
      } else {
        result[key] = parseYamlValue(val);
        currentArrayKey = null;
        currentSubKey = null;
      }
    }
  }

  return result;
}

function parseYamlValue(val: string): string | boolean | number | string[] {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  // Inline array: [a, b, c]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(s => s.length > 0);
  }
  return val.replace(/^"(.*)"$/, '$1');
}

// === Helpers ===

function toArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as string[];
  return [];
}

// === v0.1 → v0.2 helpers (preserved) ===

function createBackup(pmemPath: string, toVersion: string): void {
  const dateStr = new Date().toISOString().split('T')[0];
  const backupDir = path.join(pmemPath, 'backups', `${dateStr}-before-v${toVersion}`);
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
