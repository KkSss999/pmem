import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { ensureDir, writeFile, fileExists, atomicWrite } from '../core/fs';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { InitScanResult, InitScanCandidate } from '../types';
import { DOMAIN_PRESETS, type DomainPreset } from '../core/domainPresets';
import { rebuildCommand } from './rebuild';
import { findProjectPaths } from '../core/projectRoot';

const PMEM_DIR = '.pmem';

interface InitAnswers {
  description?: string;
  stage?: string;
  next?: string;
}

const INDEX_MD = `# Project Memory Index

## Project
Name: {{PROJECT_NAME}}
Stage: {{PROJECT_STAGE}}

## Current Focus
{{CURRENT_FOCUS}}

## Read First
- .pmem/state.md
- .pmem/next.md

## Stable Decisions
(No decisions recorded yet.)

## Current Risks
(No risks identified yet.)

## CLI
Use:
pmem context "<task>"
pmem ask "<query>"
pmem sync -s "<what changed>" -n "<next step>"
`;

const STATE_MD = `# Project State

## Overall Status
Just initialized.

## Modules
| Module | Status | Last Updated |
|--------|--------|--------------|
| (none) | -      | -            |

## Active Tasks
(No active tasks yet.)

## Recent Changes
- Project memory initialized.
`;

const NEXT_MD = `# Next Steps

<!-- pmem:next:start -->
## Recommended Next Step
Define your first module or decision card.

## Why
Building memory cards early establishes the project knowledge graph.

## Needed Context
Run \`pmem context "<task>"\` to restore task-specific project context.
<!-- pmem:next:end -->
`;

const RECALL_SKILL = `# Skill: Recall Project Memory

Use this when you need to understand the project.

## Steps
1. Start focused work with:
   \`pmem context "<task>"\`
2. Use \`pmem recall\` when you need a general project overview.
3. If the user asks about a specific module or decision, run:
   \`pmem ask "<module or task>"\`
4. Only read detailed memory cards returned by pmem when needed.

## Token Rule
Do not read all memory files unless explicitly requested.
`;

const TASK_SKILL = `# Skill: Task

Use this before modifying files or executing tasks.

## Daily Workflow
1. Restore task-specific context:
   \`pmem context "<task>"\`
2. Complete and verify the work.
3. Sync the result back to project memory:
   \`pmem sync -s "<what changed>" -n "<next step>"\`
4. Run \`pmem verify\` before handing off.

## Advanced Diagnostics
When you need to inspect or control the update pipeline step by step:
- Run \`pmem status --format json\`
- Run \`pmem mark-dirty --auto\`
- Run \`pmem update --suggest --format json\`
- Confirm the memory update with \`pmem update --confirm -s "<summary>" -n "<next step>"\`
`;

const UPDATE_SKILL = `# Skill: Update Memory

Use this after completing a task.

## Default
Run \`pmem sync -s "<what changed>" -n "<next step>"\` to detect changes,
update memory, and rebuild the local indexes in one flow.

Use \`pmem status\`, \`pmem mark-dirty\`, and \`pmem update\` directly only
when you need to review or control those stages separately.

## Must Update
- state.md when project state changed
- next.md when the next recommended action changed
- traces/YYYY-MM-DD-*.md when work completed

## Add Decision When
- Architecture/Design changed
- Project direction changed
- Major tradeoff was made
- A previous assumption was invalidated
`;

const DISTILL_SKILL = `# Skill: Distill Memory

Use this to consolidate traces into stable memory cards.

## When to Distill
- After completing a milestone
- When traces/ has accumulated 10+ undistilled entries
- Weekly, as part of project maintenance

## Steps
1. Run \`pmem distill\` to see suggestions (dry-run).
2. Review the suggested updates for each target card.
3. Run \`pmem distill --confirm\` to apply.
4. Run \`pmem rebuild\` to update indexes.
5. Run \`pmem verify\` to check consistency.

## What Gets Distilled
- Trace summaries are added to their related foundational/decision cards.
- Traces are marked as distilled in their frontmatter.
- Original trace files are preserved for evidence.

## Split Suggestions
Run \`pmem distill --suggest-splits\` to detect oversized cards.
`;

const AGENTS_MD = `# AGENTS.md

This project uses pmem for project memory.

pmem stores source-of-truth memory as Markdown cards under \`.pmem/\` and rebuilds SQLite indexes for fast agent recall. Do not edit \`.pmem/pmem.db\` directly.

## Daily Workflow

\`\`\`bash
pmem context "<current task>"
# Complete and verify the work.
pmem sync -s "<what changed>" -n "<next step>"
pmem verify
\`\`\`

For a specific memory lookup:

\`\`\`bash
pmem ask "<task or memory card>" --format compact
\`\`\`

## Read

Only read memory cards returned by pmem unless more context is needed.

## Advanced Update Diagnostics

Use the expanded workflow only when you need to inspect each update stage:
\`\`\`bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
pmem update --confirm -s "<what changed>" -n "<next step>"
\`\`\`

\`pmem update --suggest\` exits 0. Parse the JSON output (e.g., check \`summary.has_actionable\`) to see if any memory update is suggested.

## Source Of Truth

- Markdown cards in \`.pmem/**/*.md\` are canonical.
- \`.pmem/pmem.db\` is a rebuildable SQLite runtime index.
- \`pmem sync\` keeps the index current; use \`pmem rebuild\` after manual card edits.

## More Workflows

Task-specific workflows are in:

\`\`\`txt
.pmem/skills/
\`\`\`
`;

// === Interactive Helpers ===

function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer.trim()));
  });
}

async function guidedInit(projectName: string): Promise<{ description: string; stage: string; nextStep: string }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== pmem guided initialization ===\n');
  console.log('Answer 3 questions to set up your project memory.\n');

  const description = await askQuestion(rl, `1. What is this project about? (one-line description)\n> `);
  const stage = await askQuestion(rl, `\n2. What is the current stage? (e.g., "Beta productization", "MVP in progress")\n> `);
  const nextStep = await askQuestion(rl, `\n3. What is the most important next step?\n> `);

  rl.close();

  return { description, stage, nextStep };
}

function scanProject(): InitScanResult {
  const cwd = process.cwd();
  const stack: string[] = [];
  const sourceDirectories: string[] = [];
  const candidates: InitScanCandidate[] = [];

  // Detect tech stack
  const pkgJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      stack.push('Node.js');
      if (pkg.dependencies?.next || pkg.devDependencies?.next) stack.push('Next.js');
      if (pkg.dependencies?.react) stack.push('React');
      if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push('TypeScript');
    } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) stack.push('Rust');
  if (fs.existsSync(path.join(cwd, 'go.mod'))) stack.push('Go');
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) stack.push('Python');
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) stack.push('Java/Maven');

  // Scan source directories
  for (const dir of ['src', 'lib', 'app', 'packages', 'tests', 'docs', 'scripts']) {
    if (fs.existsSync(path.join(cwd, dir)) && fs.statSync(path.join(cwd, dir)).isDirectory()) {
      sourceDirectories.push(dir + '/');
    }
  }

  // Generate module candidates from src/ subdirectories
  const srcDir = path.join(cwd, 'src');
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__tests__') {
        candidates.push({
          suggestedId: `module.${entry.name.replace(/[^a-z0-9_]/g, '_')}`,
          path: `src/${entry.name}/`,
          confidence: 'medium',
        });
      }
    }
  }

  return { stack, sourceDirectories, candidates };
}

function writeGuidedMemory(
  pmemPath: string,
  projectName: string,
  info: { description: string; stage: string; nextStep: string },
  scan: InitScanResult
): void {
  const indexContent = `# Project Memory Index

## Project
Name: ${projectName}
Stage: ${info.stage}
Status: active

## Summary
${info.description}

${scan.stack.length > 0 ? `## Detected Stack\n${scan.stack.map(s => `- ${s}`).join('\n')}\n` : ''}
## Current Focus
${info.nextStep}

## Read First
- .pmem/state.md
- .pmem/next.md

## Stable Decisions
(No decisions recorded yet.)

## Current Risks
(No risks identified yet.)

## CLI
Use:
pmem context "<task>"
pmem ask "<query>"
pmem sync -s "<what changed>" -n "<next step>"
`;

  const stateContent = `# Project State

## Overall Status
${info.stage}

## Modules
| Module | Status | Last Updated |
|--------|--------|--------------|
${scan.candidates.map(c => `| ${c.suggestedId.replace('module.', '')} | candidate | - |`).join('\n') || '| (none) | - | - |'}

## Active Tasks
(No active tasks yet.)

## Recent Changes
- Project memory initialized via guided setup.
`;

  const nextContent = `# Next Steps

<!-- pmem:next:start -->
## Recommended Next Step
${info.nextStep}

## Why
Identified during guided initialization.

## Needed Context
Run \`pmem context "<task>"\` to restore task-specific project context.
<!-- pmem:next:end -->
`;

  const candidatesContent = `# Generated Module Candidates

Generated by pmem init scan on ${new Date().toISOString().split('T')[0]}.

## Candidates

${scan.candidates.map(c => `### ${c.path}
- Suggested ID: ${c.suggestedId}
- Confidence: ${c.confidence}
`).join('\n') || '(No candidates detected — create memory cards manually when useful.)\n'}
## Confirm
Review these candidates and create confirmed memory cards when useful:
\`\`\`bash
pmem new <type> "<title>"
pmem sync -s "Added initial memory cards" -n "<next step>"
\`\`\`
`;

  atomicWrite(path.join(pmemPath, 'index.md'), indexContent);
  atomicWrite(path.join(pmemPath, 'state.md'), stateContent);
  atomicWrite(path.join(pmemPath, 'next.md'), nextContent);
  atomicWrite(path.join(pmemPath, 'candidates', 'modules.generated.md'), candidatesContent);
}

function writeMinimalCandidates(pmemPath: string, scan: InitScanResult): void {
  const candidatesContent = `# Generated Module Candidates

Generated by pmem init scan on ${new Date().toISOString().split('T')[0]}.
Memory status: ready (review these candidates when you want richer project memory).

## Candidates

${scan.candidates.map(c => `### ${c.path}
- Suggested ID: ${c.suggestedId}
- Confidence: ${c.confidence}
`).join('\n') || '(No candidates detected — create memory cards manually when useful.)\n'}
## Confirm
Review these candidates and create confirmed memory cards when useful:
\`\`\`bash
pmem new <type> "<title>"
pmem sync -s "Added initial memory cards" -n "<next step>"
\`\`\`
`;

  atomicWrite(path.join(pmemPath, 'candidates', 'modules.generated.md'), candidatesContent);
}

// === Answers File ===

function loadAnswersFile(filePath: string): InitAnswers | null {
  const cwd = process.cwd();
  const absPath = path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Answers file not found: ${absPath}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      console.error('Answers file must contain a JSON object.');
      return null;
    }
    return {
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      stage: typeof parsed.stage === 'string' ? parsed.stage : undefined,
      next: typeof parsed.next === 'string' ? parsed.next : undefined,
    };
  } catch (err: any) {
    console.error(`Failed to parse answers file: ${err?.message || err}`);
    return null;
  }
}

// === Main Command ===

export async function initCommand(options: {
  guided?: boolean;
  projectName?: string;
  description?: string;
  stage?: string;
  next?: string;
  answers?: string;
  domain?: string;
}): Promise<void> {
  const cwd = process.cwd();
  const existingProject = findProjectPaths(cwd);
  const pmemPath = existingProject?.pmemPath ?? path.join(cwd, PMEM_DIR);

  if (existingProject || fileExists(pmemPath)) {
    console.log(`.pmem already exists at ${pmemPath}`);
    console.log('To reinitialize, remove .pmem/ first.');
    return;
  }

  const domain = options.domain || 'software';
  const preset = DOMAIN_PRESETS[domain];
  if (!preset) {
    console.error(`Error: Invalid domain "${domain}".`);
    console.error(`Valid domains are: ${Object.keys(DOMAIN_PRESETS).join(', ')}`);
    process.exit(2);
  }

  const name = options.projectName || path.basename(cwd);

  // Run project scan (used by both modes)
  const scan = scanProject();

  // Resolve guided info from args, answers file, or interactive prompt
  let guidedInfo: { description: string; stage: string; nextStep: string } | null = null;

  if (options.guided) {
    // Merge: answers file first, then CLI args override
    const answers: InitAnswers = {};
    if (options.answers) {
      const fileAnswers = loadAnswersFile(options.answers);
      if (!fileAnswers) {
        console.error('Failed to load answers file. Falling back to defaults.');
      } else {
        Object.assign(answers, fileAnswers);
      }
    }
    if (options.description) answers.description = options.description;
    if (options.stage) answers.stage = options.stage;
    if (options.next) answers.next = options.next;

    const hasDescription = !!answers.description;
    const hasStage = !!answers.stage;
    const hasNext = !!answers.next;

    // All three present → non-interactive mode
    if (hasDescription && hasStage && hasNext) {
      guidedInfo = {
        description: answers.description!,
        stage: answers.stage!,
        nextStep: answers.next!,
      };
    } else if (hasDescription || hasStage || hasNext) {
      // v0.6.4 polish 7: partial flags — warn + suggest, do not block.
      // Init still proceeds with empty strings for missing fields. The user can
      // fill those fields in the generated source-of-truth Markdown later.
      const missing: string[] = [];
      if (!hasDescription) missing.push('--description');
      if (!hasStage) missing.push('--stage');
      if (!hasNext) missing.push('--next');
      const firstMissing = missing[0];
      console.error(`⚠ Missing ${firstMissing}. --guided works best with all three context flags.`);
      console.error(`  You can re-run with: pmem init ${name} --guided \\`);
      console.error(`    --description "<one-line project purpose>" \\`);
      console.error(`    --stage "<current stage>" \\`);
      console.error(`    --next "<immediate next step>"`);
      console.error(`  Or answer via: pmem init ${name} --guided --answers ./pmem-init.json`);
      console.error(`  Missing: ${missing.join(', ')}`);
      console.error(`  Continuing init with empty values for the missing field(s).`);
      console.error(`  Fill them later in .pmem/index.md, .pmem/state.md, or .pmem/next.md, then run pmem sync.`);
      guidedInfo = {
        description: answers.description || '',
        stage: answers.stage || '',
        nextStep: answers.next || '',
      };
    } else {
      // No args → interactive TTY
      guidedInfo = await guidedInit(name);
    }
  } else if (options.answers) {
    // --answers without --guided: also valid, implied guided
    const fileAnswers = loadAnswersFile(options.answers);
    if (!fileAnswers) {
      console.error('Failed to load answers file.');
      return;
    }
    if (options.description) fileAnswers.description = options.description;
    if (options.stage) fileAnswers.stage = options.stage;
    if (options.next) fileAnswers.next = options.next;

    if (fileAnswers.description && fileAnswers.stage && fileAnswers.next) {
      guidedInfo = {
        description: fileAnswers.description,
        stage: fileAnswers.stage,
        nextStep: fileAnswers.next,
      };
    } else {
      const missing: string[] = [];
      if (!fileAnswers.description) missing.push('description');
      if (!fileAnswers.stage) missing.push('stage');
      if (!fileAnswers.next) missing.push('next');
      console.error(`Answers file missing required fields: ${missing.join(', ')}`);
      console.error('File must contain: { "description": "...", "stage": "...", "next": "..." }');
      return;
    }
  }

  // Create directory structure
  const presetDirs = Object.values(preset.type_dirs).map(d => `.pmem/${d}`);
  const dirs = Array.from(new Set([
    ...presetDirs,
    '.pmem/summaries',
    '.pmem/skills',
    '.pmem/candidates',
    '.pmem/indexes',
    '.pmem/integrations/claude-code',
    '.pmem/integrations/cursor',
    '.pmem/integrations/codex',
  ]));

  console.log('Creating .pmem/ directory structure...');
  for (const dir of dirs) {
    ensureDir(path.join(cwd, dir));
  }

  // Write manifest with appropriate init mode
  const manifest = guidedInfo
    ? getDefaultManifest(name, 'guided')
    : getDefaultManifest(name, 'minimal');

  // Customize manifest for domain preset
  manifest.project.domain = domain;
  manifest.schema = {
    card_types: preset.card_types,
    type_dirs: preset.type_dirs,
    foundational_types: preset.foundational_types,
    evidence_types: preset.evidence_types,
    default_type: preset.default_type,
    creatable_types: preset.creatable_types,
  };
  manifest.card_policy.id_pattern = '^({types})\\.[a-z0-9._-]+$';
  manifest.source_of_truth.card_globs = Object.values(preset.type_dirs).map(
    dir => `.pmem/${dir}/**/*.md`
  );
  if (preset.max_tokens) {
    manifest.card_policy.max_tokens = preset.max_tokens;
  }
  if (preset.max_sections) {
    manifest.card_policy.max_sections = preset.max_sections;
  }
  if (preset.warn_when_related_count_gt_by_type) {
    manifest.card_policy.warn_when_related_count_gt_by_type = preset.warn_when_related_count_gt_by_type;
  }

  // Phase 4: discover default disable & domain-neutral ignores
  manifest.discover = {
    enabled: domain === 'software'
  };
  if (domain === 'software') {
    manifest.auto_update.ignore_patterns = [
      'node_modules/**', 'dist/**', 'build/**', '*.lock', '*.log',
    ];
  } else {
    manifest.auto_update.ignore_patterns = [
      '*.lock', '*.log',
    ];
  }

  saveManifest(pmemPath, manifest);

  if (guidedInfo) {
    // Write richer guided memory files
    writeGuidedMemory(pmemPath, name, guidedInfo, scan);
  } else {
    // Write default template files
    const replacements = { PROJECT_NAME: name, PROJECT_STAGE: 'Initialized', CURRENT_FOCUS: 'Set up project memory.' };
    writeFile(path.join(pmemPath, 'index.md'), replaceTemplate(INDEX_MD, replacements));
    writeFile(path.join(pmemPath, 'state.md'), STATE_MD);
    writeFile(path.join(pmemPath, 'next.md'), NEXT_MD);

    // Write minimal candidates from scan
    writeMinimalCandidates(pmemPath, scan);
  }

  // Write skills
  writeFile(path.join(pmemPath, 'skills', 'recall.md'), RECALL_SKILL);
  writeFile(path.join(pmemPath, 'skills', 'task.md'), TASK_SKILL);
  writeFile(path.join(pmemPath, 'skills', 'update.md'), UPDATE_SKILL);
  writeFile(path.join(pmemPath, 'skills', 'distill.md'), DISTILL_SKILL);

  // Write integration templates with v0.6 Agent-native Workflow Polish instructions
  writeFile(path.join(pmemPath, 'integrations', 'claude-code', 'CLAUDE.md'), `# pmem integration for Claude Code

pmem keeps project memory in Markdown cards under .pmem/ and rebuilds SQLite indexes for fast recall. Markdown cards are the source of truth; do not edit .pmem/pmem.db directly.

## Daily Workflow
\`\`\`bash
pmem context "<current task>"
# Complete and verify the work.
pmem sync -s "<what changed>" -n "<next step>"
pmem verify
\`\`\`

## Specific Memory Lookup
\`\`\`bash
pmem ask "<task or memory card>" --format compact
\`\`\`

## Advanced Update Diagnostics
Use this expanded flow only when you need to inspect each stage:
\`\`\`bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
pmem update --confirm -s "<summary>" -n "<next step>"
\`\`\`

\`pmem update --suggest\` exits 0. Parse the JSON output (e.g., check \`summary.has_actionable\`) to see if any memory update is suggested.

## Optional Hooks (.claude/settings.json)
\`\`\`json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "command": "cd \${CLAUDE_PROJECT_DIR} && pmem mark-dirty -r \\"File modified by Claude\\""
    }]
  }
}
\`\`\`
`);
  writeFile(path.join(pmemPath, 'integrations', 'claude-code', 'settings.example.json'), '{}\n');
  writeFile(path.join(pmemPath, 'integrations', 'cursor', 'rules.example.md'), `# Cursor Rules with pmem

## Daily Workflow
1. Start focused work with \`pmem context "<current task>"\`.
2. Complete and verify the work.
3. Finish with \`pmem sync -s "<what changed>" -n "<next step>" && pmem verify\`.

## Specific Memory Lookup
\`pmem ask "<task or memory card>" --format compact\`

## Advanced Update Diagnostics
When you need to inspect each stage: \`pmem status --format json && pmem mark-dirty --auto && pmem update --suggest --format json\`

\`pmem update --suggest\` exits 0. Parse the JSON output (e.g., check \`summary.has_actionable\`) to see if any memory update is suggested.

## Source Of Truth
Markdown cards under \`.pmem/\` are canonical. SQLite indexes are rebuildable runtime data.
`);
  writeFile(path.join(pmemPath, 'integrations', 'codex', 'AGENTS.md'), `# pmem + Codex Integration

## Quick Start
\`\`\`bash
pmem context "<current task>"
# Complete and verify the work.
pmem sync -s "<what changed>" -n "<next step>"
pmem verify
\`\`\`

## Memory-Aware Workflow
1. Start a task with \`pmem context "<task description>"\`.
2. Use \`pmem ask "<specific question>" --format compact\` for focused lookup.
3. Edit and verify the code.
4. Finish with \`pmem sync -s "<what changed>" -n "<next step>"\`.

## Advanced Update Diagnostics
Use \`pmem status --format json\`, \`pmem mark-dirty --auto\`, and
\`pmem update --suggest --format json\` when you need to inspect each stage.
\`pmem update --suggest\` exits 0; parse \`summary.has_actionable\`.

## Source Of Truth
Markdown cards under \`.pmem/\` are canonical. \`.pmem/pmem.db\` is a rebuildable SQLite runtime index.
`);

  // Write AGENTS.md in project root
  writeFile(path.join(cwd, 'AGENTS.md'), AGENTS_MD);

  // Build the first deterministic local index as part of initialization. This
  // makes `pmem ask` and `pmem context` immediately usable without pulling a
  // model or requiring a separate `pmem rebuild` step.
  console.log('\nBuilding first local index...');
  try {
    rebuildCommand({ cwd, silent: true });
    if (!fileExists(path.join(pmemPath, 'pmem.db'))) {
      throw new Error('the SQLite index was not created');
    }
  } catch (err: any) {
    console.error('\n✗ pmem initialization is incomplete: the source files were created, but the local index is not ready.');
    console.error(`  ${err?.message || err}`);
    console.error('  Resolve the error, then run `pmem rebuild --full`.');
    process.exitCode = 2;
    return;
  }

  // Print summary
  console.log(`\n✓ pmem is ready for project "${name}"`);
  console.log(`  .pmem/    — memory cards, skills, indexes, integrations`);
  console.log(`  AGENTS.md — agent entry instructions`);

  if (scan.stack.length > 0) {
    console.log(`\nDetected stack: ${scan.stack.join(', ')}`);
  }
  if (scan.sourceDirectories.length > 0) {
    console.log(`Source directories: ${scan.sourceDirectories.join(', ')}`);
  }
  if (scan.candidates.length > 0) {
    console.log(`Module candidates: ${scan.candidates.map(c => c.suggestedId).join(', ')}`);
  }

  if (guidedInfo) {
    const mode = options.guided && !options.description && !options.stage && !options.next && !options.answers
      ? 'interactive' : 'non-interactive';
    console.log(`  Guided setup: ${mode}`);
  }

  console.log('\nNext:');
  console.log('  1. Start:  `pmem context "<your task>"`');
  console.log('  2. Search: `pmem ask "<question>"`');
  console.log('  3. Finish: `pmem sync -s "<what changed>" -n "<next step>"`');
}

function replaceTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
