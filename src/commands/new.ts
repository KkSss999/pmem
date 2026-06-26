import * as path from 'path';
import { ensureDir, atomicWrite, fileExists } from '../core/fs';
import { loadManifest } from '../core/manifest';
import { resolveConfig } from '../core/manifest';

const PMEM_DIR = '.pmem';

export function newCommand(type: string, title: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    console.log('No manifest found. Run `pmem init` first.');
    return;
  }

  const config = resolveConfig(manifest);

  // Validate type against manifest-declared creatable_types.
  // Old projects: v0.6.4 VALID_TYPES (6). Custom projects: card_types minus internals.
  if (!config.creatable_types.includes(type)) {
    console.log(`Error: Invalid card type "${type}".`);
    console.log(`Valid types: ${config.creatable_types.join(', ')}`);
    process.exit(2);
  }

  // Validate title
  if (!title || title.trim().length === 0) {
    console.log('Error: Title must not be empty.');
    console.log('Usage: pmem new <type> "<title>"');
    console.log('Example: pmem new decision "My decision title"');
    process.exit(2);
  }

  const trimmedTitle = title.trim();

  // Generate ID from title
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = trimmedTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
  const id = `${type}.${slug}_${today}`;

  // Determine target directory from resolved config
  // Built-in preset types have explicit mappings; custom types fall back to `${type}s`
  const dirName = config.type_dirs[type];
  const dirPath = path.join(pmemPath, dirName);
  ensureDir(dirPath);

  const fileName = `${id}.md`;
  const filePath = path.join(dirPath, fileName);

  if (fileExists(filePath)) {
    console.log(`Error: Card file already exists: ${path.relative(cwd, filePath)}`);
    console.log('Choose a different title or remove the existing card first.');
    process.exit(2);
  }

  // Generate frontmatter
  const created = new Date().toISOString().slice(0, 10);
  // Escape double-quotes and backslashes in title for valid YAML
  const yamlSafeTitle = trimmedTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const frontmatter = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: "${yamlSafeTitle}"`,
    'status: draft',
    'tags: []',
    `created: "${created}"`,
    'source_files: []',
    'depends_on: []',
    'related: []',
    '---',
    `# ${trimmedTitle}`,
    '',
    `<!-- TODO: describe the ${type}, context, and any relevant details -->`,
    '',
  ].join('\n');

  // Write card file
  atomicWrite(filePath, frontmatter);

  const relPath = path.relative(cwd, filePath);
  console.log(`✓ Created ${type} card: ${relPath}`);
  console.log(`  ID: ${id}`);
  console.log('  Next: edit the card body, then run `pmem rebuild` and `pmem verify`.');
}
