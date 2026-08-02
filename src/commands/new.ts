import * as path from 'path';
import { ensureDir, atomicWrite, fileExists } from '../core/fs';
import { loadManifest, renderIdPattern, resolveConfig } from '../core/manifest';
import { findProjectPaths } from '../core/projectRoot';

const PMEM_DIR = '.pmem';

/**
 * `pmem new` is an explicit authoring action. Structured cards created this
 * way are therefore user-confirmed by default, while traces remain evidence
 * produced by an agent/workflow and must stay outside the trusted semantic
 * allowlist until a user promotes them deliberately.
 */
const TRUST_LABEL_BY_TYPE: Record<string, 'user_confirmed' | 'agent_generated'> = {
  trace: 'agent_generated',
};
const DEFAULT_TRUST_LABEL = 'user_confirmed' as const;
const DEFAULT_SENSITIVITY = 'internal' as const;
const SAFE_CLASSIFICATION_BY_TYPE: Record<string, string> = {
  decision: 'decision',
  task: 'plan',
  feature: 'plan',
  risk: 'risk',
  assumption: 'assumption',
};

export interface NewCommandOptions {
  id?: string;
}

export function newCommand(type: string, title: string, options: NewCommandOptions = {}): void {
  const cwd = process.cwd();
  const pmemPath = findProjectPaths(cwd)?.pmemPath ?? path.join(cwd, PMEM_DIR);

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

  let id: string;
  if (options.id !== undefined) {
    const requestedId = options.id.trim();
    if (!requestedId) {
      console.log('Error: --id must not be empty.');
      process.exit(2);
    }

    // Accept either a meaningful slug (`protagonist`) or an exact ID whose
    // prefix matches the positional card type (`character.protagonist`).
    // A prefix belonging to another declared type is almost certainly a typo,
    // so reject it instead of silently producing `character.task.foo`.
    const declaredPrefix = [...config.card_types]
      .sort((a, b) => b.length - a.length)
      .find(cardType => requestedId.startsWith(`${cardType}.`));
    if (declaredPrefix && declaredPrefix !== type) {
      console.log(`Error: Custom ID type "${declaredPrefix}" does not match requested card type "${type}".`);
      process.exit(2);
    }
    id = declaredPrefix === type ? requestedId : `${type}.${requestedId}`;

    const renderedPattern = renderIdPattern(manifest.card_policy.id_pattern, config.card_types);
    const manifestPattern = new RegExp(renderedPattern);
    const manifestRecognizesType = manifestPattern.test(`${type}.valid`);
    // Some v0.7 custom-schema projects retained the legacy fixed-type
    // id_pattern. They already permit creating their declared custom types, so
    // preserve that compatibility while still enforcing a path-safe suffix.
    const escapedType = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const compatiblePattern = `^${escapedType}\\.[a-z0-9][a-z0-9._-]*$`;
    const valid = manifestRecognizesType
      ? (new RegExp(renderedPattern)).test(id)
      : (new RegExp(compatiblePattern)).test(id);
    if (!valid) {
      console.log(`Error: Custom card ID "${id}" does not match the project naming pattern.`);
      console.log(`Expected: ${manifestRecognizesType ? renderedPattern : compatiblePattern}`);
      process.exit(2);
    }
  } else {
    // Preserve the historical date-stamped default for callers that do not
    // opt into a stable meaningful ID.
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const slug = trimmedTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);
    id = `${type}.${slug}_${today}`;
  }

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
  const trustLabel = TRUST_LABEL_BY_TYPE[type] ?? DEFAULT_TRUST_LABEL;
  const classification = SAFE_CLASSIFICATION_BY_TYPE[type];
  // Escape double-quotes and backslashes in title for valid YAML
  const yamlSafeTitle = trimmedTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const frontmatter = [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: "${yamlSafeTitle}"`,
    'status: draft',
    ...(classification ? [`classification: ${classification}`] : []),
    `trust_label: ${trustLabel}`,
    `sensitivity: ${DEFAULT_SENSITIVITY}`,
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
