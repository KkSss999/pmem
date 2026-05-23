import * as path from 'path';
import { ensureDir, atomicWrite, fileExists } from '../core/fs';

const PMEM_DIR = '.pmem';

const VALID_TYPES = ['decision', 'module', 'task', 'feature', 'risk', 'trace'];

const TYPE_DIR_MAP: Record<string, string> = {
  decision: 'decisions',
  module: 'modules',
  task: 'tasks',
  feature: 'features',
  risk: 'risks',
  trace: 'traces',
};

export function newCommand(type: string, title: string): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  // Validate type
  if (!VALID_TYPES.includes(type)) {
    console.log(`Error: Invalid card type "${type}".`);
    console.log(`Valid types: ${VALID_TYPES.join(', ')}`);
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

  // Determine target directory and file path
  const dirName = TYPE_DIR_MAP[type];
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
    'related_to: []',
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
