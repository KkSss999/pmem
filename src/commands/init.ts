import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { ensureDir, writeFile, fileExists, atomicWrite } from '../core/fs';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { InitScanResult, InitScanCandidate } from '../types';

const PMEM_DIR = '.pmem';

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
pmem recall
pmem next
pmem ask "<query>"
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

## Recommended Next Step
Define your first module or decision card.

## Why
Building memory cards early establishes the project knowledge graph.

## Needed Context
Run \`pmem recall\` to see the current project state.
`;

const RECALL_SKILL = `# Skill: Recall Project Memory

Use this when you need to understand the project.

## Steps
1. Read \`.pmem/index.md\`.
2. Read \`.pmem/state.md\`.
3. Read \`.pmem/next.md\`.
4. If the user asks about a specific module, run:
   \`pmem recall <keyword>\`
5. Only read detailed memory cards when needed.

## Token Rule
Do not read all memory files unless explicitly requested.
`;

const CODE_TASK_SKILL = `# Skill: Code Task

Use this before modifying code.

## Required Reads
- .pmem/index.md
- .pmem/state.md
- .pmem/modules related to the target code
- .pmem/decisions related to the target module

## Required Writes
After task completion:
- Update \`.pmem/state.md\`
- Add trace to \`.pmem/traces/\`
- Update graph if new module/decision/task appears
`;

const UPDATE_SKILL = `# Skill: Update Memory

Use this after completing a task.

## Must Update
- state.md
- next.md
- traces/YYYY-MM-DD-*.md

## Add Decision When
- Architecture changed
- Product direction changed
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
- Trace summaries are added to their related module/decision/task cards.
- Traces are marked as distilled in their frontmatter.
- Original trace files are preserved for evidence.

## Split Suggestions
Run \`pmem distill --suggest-splits\` to detect oversized cards.
`;

const AGENTS_MD = `# AGENTS.md

This project uses pmem for project memory.

## Start
Run:

\`\`\`bash
pmem recall --budget 2000
\`\`\`

For specific tasks, run:

\`\`\`bash
pmem ask "<task>"
\`\`\`

## Read

Only read memory cards returned by pmem unless more context is needed.

## Update

After completing work, run:

\`\`\`bash
pmem update
pmem verify
\`\`\`

## More

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
  const stage = await askQuestion(rl, `\n2. What is the current stage? (e.g., "v0.2 completed, preparing v0.3")\n> `);
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
pmem recall
pmem next
pmem ask "<query>"
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

## Recommended Next Step
${info.nextStep}

## Why
Identified during guided initialization.

## Needed Context
Run \`pmem recall\` to see the current project state.
`;

  const candidatesContent = `# Generated Module Candidates

Generated by pmem init scan on ${new Date().toISOString().split('T')[0]}.

## Candidates

${scan.candidates.map(c => `### ${c.path}
- Suggested ID: ${c.suggestedId}
- Confidence: ${c.confidence}
`).join('\n') || '(No candidates detected — create modules manually.)\n\n```bash\npmem update --confirm\n```\n'}
## Confirm
Review these candidates and create confirmed module cards manually, or run:
\`\`\`bash
pmem init --guided
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
Memory status: incomplete (minimal init — review these candidates and run \`pmem init --guided\` for richer setup).

## Candidates

${scan.candidates.map(c => `### ${c.path}
- Suggested ID: ${c.suggestedId}
- Confidence: ${c.confidence}
`).join('\n') || '(No candidates detected — create modules manually.)\n\n```bash\npmem update --confirm\n```\n'}
## Confirm
Review these candidates and create confirmed module cards manually, or run:
\`\`\`bash
pmem init --guided
\`\`\`
`;

  atomicWrite(path.join(pmemPath, 'candidates', 'modules.generated.md'), candidatesContent);
}

// === Main Command ===

export async function initCommand(options: { guided?: boolean; projectName?: string }): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (fileExists(pmemPath)) {
    console.log(`.pmem already exists at ${pmemPath}`);
    console.log('To reinitialize, remove .pmem/ first.');
    return;
  }

  const name = options.projectName || path.basename(cwd);

  // Run project scan (used by both modes)
  const scan = scanProject();

  // Guided mode: ask questions interactively
  let guidedInfo: { description: string; stage: string; nextStep: string } | null = null;
  if (options.guided) {
    guidedInfo = await guidedInit(name);
  }

  // Create directory structure
  const dirs = [
    '.pmem/modules',
    '.pmem/features',
    '.pmem/decisions',
    '.pmem/tasks',
    '.pmem/traces',
    '.pmem/summaries',
    '.pmem/skills',
    '.pmem/candidates',
    '.pmem/risks',
    '.pmem/indexes',
    '.pmem/integrations/claude-code',
    '.pmem/integrations/cursor',
    '.pmem/integrations/codex',
  ];

  console.log('Creating .pmem/ directory structure...');
  for (const dir of dirs) {
    ensureDir(path.join(cwd, dir));
  }

  // Write manifest with appropriate init mode
  if (options.guided && guidedInfo) {
    const manifest = getDefaultManifest(name, 'guided');
    saveManifest(pmemPath, manifest);

    // Write richer guided memory files
    writeGuidedMemory(pmemPath, name, guidedInfo, scan);
  } else {
    const manifest = getDefaultManifest(name, 'minimal');
    saveManifest(pmemPath, manifest);

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
  writeFile(path.join(pmemPath, 'skills', 'code-task.md'), CODE_TASK_SKILL);
  writeFile(path.join(pmemPath, 'skills', 'update.md'), UPDATE_SKILL);
  writeFile(path.join(pmemPath, 'skills', 'distill.md'), DISTILL_SKILL);

  // Write integration templates (empty for now)
  writeFile(path.join(pmemPath, 'integrations', 'claude-code', 'CLAUDE.md'), '# Claude Code integration\n\n(Configure your integration here.)\n');
  writeFile(path.join(pmemPath, 'integrations', 'claude-code', 'settings.example.json'), '{}\n');
  writeFile(path.join(pmemPath, 'integrations', 'cursor', 'rules.example.md'), '# Cursor rules\n\n(Configure your integration here.)\n');
  writeFile(path.join(pmemPath, 'integrations', 'codex', 'AGENTS.md'), '# Codex integration\n\n(Configure your integration here.)\n');

  // Write AGENTS.md in project root
  writeFile(path.join(cwd, 'AGENTS.md'), AGENTS_MD);

  // Print summary
  console.log(`\n✓ pmem initialized for project "${name}"`);
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

  if (options.guided) {
    console.log(`\nGuided setup complete. Run \`pmem recall\` to see your project state.`);
  } else {
    console.log(`\nNext: run \`pmem recall\` to see your project state, or \`pmem init --guided\` for interactive setup.`);
  }
}

function replaceTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
