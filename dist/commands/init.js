"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCommand = initCommand;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const fs_1 = require("../core/fs");
const manifest_1 = require("../core/manifest");
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
pmem ask "<query>"
pmem status
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
   \`pmem ask "<module or task>"\`
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
- Run \`pmem status --format json\`
- Run \`pmem mark-dirty --auto\`
- Run \`pmem update --suggest --format json\`
- Confirm the memory update with \`pmem update --confirm -s "<summary>" -n "<next step>"\`
- Run \`pmem verify\`
`;
const UPDATE_SKILL = `# Skill: Update Memory

Use this after completing a task.

## Must Update
- state.md when project state changed
- next.md when the next recommended action changed
- traces/YYYY-MM-DD-*.md when work completed

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

pmem stores source-of-truth memory as Markdown cards under \`.pmem/\` and rebuilds SQLite indexes for fast agent recall. Do not edit \`.pmem/pmem.db\` directly.

## Session Start

\`\`\`bash
pmem session start -a "Codex"
pmem recall --format compact --budget 2000
\`\`\`

For specific work, ask pmem first:

\`\`\`bash
pmem ask "<task or module>" --format compact
\`\`\`

## Read

Only read memory cards returned by pmem unless more context is needed.

## After Editing Code

\`\`\`bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
\`\`\`

\`pmem update --suggest\` exits with code 1 when suggestions exist. Treat that as "action suggested", not as a hard failure.

## Session End

Before finishing work:

\`\`\`bash
pmem update --confirm -s "<what changed>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
\`\`\`

## Source Of Truth

- Markdown cards in \`.pmem/**/*.md\` are canonical.
- \`.pmem/pmem.db\` is a rebuildable SQLite runtime index.
- Run \`pmem rebuild\` after changing memory cards.

## More Workflows

Task-specific workflows are in:

\`\`\`txt
.pmem/skills/
\`\`\`
`;
// === Interactive Helpers ===
function askQuestion(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}
async function guidedInit(projectName) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n=== pmem guided initialization ===\n');
    console.log('Answer 3 questions to set up your project memory.\n');
    const description = await askQuestion(rl, `1. What is this project about? (one-line description)\n> `);
    const stage = await askQuestion(rl, `\n2. What is the current stage? (e.g., "Beta productization", "MVP in progress")\n> `);
    const nextStep = await askQuestion(rl, `\n3. What is the most important next step?\n> `);
    rl.close();
    return { description, stage, nextStep };
}
function scanProject() {
    const cwd = process.cwd();
    const stack = [];
    const sourceDirectories = [];
    const candidates = [];
    // Detect tech stack
    const pkgJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
            stack.push('Node.js');
            if (pkg.dependencies?.next || pkg.devDependencies?.next)
                stack.push('Next.js');
            if (pkg.dependencies?.react)
                stack.push('React');
            if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript)
                stack.push('TypeScript');
        }
        catch { /* ignore */ }
    }
    if (fs.existsSync(path.join(cwd, 'Cargo.toml')))
        stack.push('Rust');
    if (fs.existsSync(path.join(cwd, 'go.mod')))
        stack.push('Go');
    if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt')))
        stack.push('Python');
    if (fs.existsSync(path.join(cwd, 'pom.xml')))
        stack.push('Java/Maven');
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
function writeGuidedMemory(pmemPath, projectName, info, scan) {
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
pmem ask "<query>"
pmem status
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
    (0, fs_1.atomicWrite)(path.join(pmemPath, 'index.md'), indexContent);
    (0, fs_1.atomicWrite)(path.join(pmemPath, 'state.md'), stateContent);
    (0, fs_1.atomicWrite)(path.join(pmemPath, 'next.md'), nextContent);
    (0, fs_1.atomicWrite)(path.join(pmemPath, 'candidates', 'modules.generated.md'), candidatesContent);
}
function writeMinimalCandidates(pmemPath, scan) {
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
    (0, fs_1.atomicWrite)(path.join(pmemPath, 'candidates', 'modules.generated.md'), candidatesContent);
}
// === Answers File ===
function loadAnswersFile(filePath) {
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
    }
    catch (err) {
        console.error(`Failed to parse answers file: ${err?.message || err}`);
        return null;
    }
}
// === Main Command ===
async function initCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    if ((0, fs_1.fileExists)(pmemPath)) {
        console.log(`.pmem already exists at ${pmemPath}`);
        console.log('To reinitialize, remove .pmem/ first.');
        return;
    }
    const name = options.projectName || path.basename(cwd);
    // Run project scan (used by both modes)
    const scan = scanProject();
    // Resolve guided info from args, answers file, or interactive prompt
    let guidedInfo = null;
    if (options.guided) {
        // Merge: answers file first, then CLI args override
        const answers = {};
        if (options.answers) {
            const fileAnswers = loadAnswersFile(options.answers);
            if (!fileAnswers) {
                console.error('Failed to load answers file. Falling back to defaults.');
            }
            else {
                Object.assign(answers, fileAnswers);
            }
        }
        if (options.description)
            answers.description = options.description;
        if (options.stage)
            answers.stage = options.stage;
        if (options.next)
            answers.next = options.next;
        const hasDescription = !!answers.description;
        const hasStage = !!answers.stage;
        const hasNext = !!answers.next;
        // All three present → non-interactive mode
        if (hasDescription && hasStage && hasNext) {
            guidedInfo = {
                description: answers.description,
                stage: answers.stage,
                nextStep: answers.next,
            };
        }
        else if (hasDescription || hasStage || hasNext) {
            // v0.6.4 polish 7: partial flags — warn + suggest, do not block.
            // Init still proceeds with empty strings for missing fields so the user
            // can re-run guided later or edit .pmem/index.md directly.
            const missing = [];
            if (!hasDescription)
                missing.push('--description');
            if (!hasStage)
                missing.push('--stage');
            if (!hasNext)
                missing.push('--next');
            const firstMissing = missing[0];
            console.error(`⚠ Missing ${firstMissing}. --guided works best with all three context flags.`);
            console.error(`  You can re-run with: pmem init ${name} --guided \\`);
            console.error(`    --description "<one-line project purpose>" \\`);
            console.error(`    --stage "<current stage>" \\`);
            console.error(`    --next "<immediate next step>"`);
            console.error(`  Or answer via: pmem init ${name} --guided --answers ./pmem-init.json`);
            console.error(`  Missing: ${missing.join(', ')}`);
            console.error(`  Continuing init with empty values for the missing field(s) — re-run guided to fill them in.`);
            guidedInfo = {
                description: answers.description || '',
                stage: answers.stage || '',
                nextStep: answers.next || '',
            };
        }
        else {
            // No args → interactive TTY
            guidedInfo = await guidedInit(name);
        }
    }
    else if (options.answers) {
        // --answers without --guided: also valid, implied guided
        const fileAnswers = loadAnswersFile(options.answers);
        if (!fileAnswers) {
            console.error('Failed to load answers file.');
            return;
        }
        if (options.description)
            fileAnswers.description = options.description;
        if (options.stage)
            fileAnswers.stage = options.stage;
        if (options.next)
            fileAnswers.next = options.next;
        if (fileAnswers.description && fileAnswers.stage && fileAnswers.next) {
            guidedInfo = {
                description: fileAnswers.description,
                stage: fileAnswers.stage,
                nextStep: fileAnswers.next,
            };
        }
        else {
            const missing = [];
            if (!fileAnswers.description)
                missing.push('description');
            if (!fileAnswers.stage)
                missing.push('stage');
            if (!fileAnswers.next)
                missing.push('next');
            console.error(`Answers file missing required fields: ${missing.join(', ')}`);
            console.error('File must contain: { "description": "...", "stage": "...", "next": "..." }');
            return;
        }
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
        (0, fs_1.ensureDir)(path.join(cwd, dir));
    }
    // Write manifest with appropriate init mode
    if (guidedInfo) {
        const manifest = (0, manifest_1.getDefaultManifest)(name, 'guided');
        (0, manifest_1.saveManifest)(pmemPath, manifest);
        // Write richer guided memory files
        writeGuidedMemory(pmemPath, name, guidedInfo, scan);
    }
    else {
        const manifest = (0, manifest_1.getDefaultManifest)(name, 'minimal');
        (0, manifest_1.saveManifest)(pmemPath, manifest);
        // Write default template files
        const replacements = { PROJECT_NAME: name, PROJECT_STAGE: 'Initialized', CURRENT_FOCUS: 'Set up project memory.' };
        (0, fs_1.writeFile)(path.join(pmemPath, 'index.md'), replaceTemplate(INDEX_MD, replacements));
        (0, fs_1.writeFile)(path.join(pmemPath, 'state.md'), STATE_MD);
        (0, fs_1.writeFile)(path.join(pmemPath, 'next.md'), NEXT_MD);
        // Write minimal candidates from scan
        writeMinimalCandidates(pmemPath, scan);
    }
    // Write skills
    (0, fs_1.writeFile)(path.join(pmemPath, 'skills', 'recall.md'), RECALL_SKILL);
    (0, fs_1.writeFile)(path.join(pmemPath, 'skills', 'code-task.md'), CODE_TASK_SKILL);
    (0, fs_1.writeFile)(path.join(pmemPath, 'skills', 'update.md'), UPDATE_SKILL);
    (0, fs_1.writeFile)(path.join(pmemPath, 'skills', 'distill.md'), DISTILL_SKILL);
    // Write integration templates with v0.6 Agent-native Workflow Polish instructions
    (0, fs_1.writeFile)(path.join(pmemPath, 'integrations', 'claude-code', 'CLAUDE.md'), `# pmem integration for Claude Code

pmem keeps project memory in Markdown cards under .pmem/ and rebuilds SQLite indexes for fast recall. Markdown cards are the source of truth; do not edit .pmem/pmem.db directly.

## Session Start
\`\`\`bash
pmem session start -a "Claude"
pmem recall --format compact --budget 2000
\`\`\`

## Before Focused Work
\`\`\`bash
pmem ask "<task or module>" --format compact
\`\`\`

## During Work (after editing files)
\`\`\`bash
pmem status --format json
pmem mark-dirty --auto
pmem update --suggest --format json
\`\`\`

\`pmem update --suggest\` exits with code 1 when suggestions exist. That is a workflow signal, not a hard failure.

## Session End
\`\`\`bash
pmem update --confirm -s "<summary>" -n "<next step>"
pmem session end -s "<task summary>"
pmem verify
\`\`\`

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
    (0, fs_1.writeFile)(path.join(pmemPath, 'integrations', 'claude-code', 'settings.example.json'), '{}\n');
    (0, fs_1.writeFile)(path.join(pmemPath, 'integrations', 'cursor', 'rules.example.md'), `# Cursor Rules with pmem

## Session Start
In Cursor's AI chat: \`pmem session start -a "Cursor" && pmem recall --format compact --budget 2000\`

## Before Focused Work
\`pmem ask "<task or module>" --format compact\`

## When Editing Code
After each significant change: \`pmem status --format json && pmem mark-dirty --auto\`

## Before Requesting Review
\`pmem update --suggest --format json\`

Exit code 1 from \`pmem update --suggest\` means suggestions exist, not that the command failed.

## End of Session
\`pmem update --confirm -s "<summary>" -n "<next>" && pmem session end -s "<summary>" && pmem verify\`

## Source Of Truth
Markdown cards under \`.pmem/\` are canonical. SQLite indexes are rebuildable runtime data.
`);
    (0, fs_1.writeFile)(path.join(pmemPath, 'integrations', 'codex', 'AGENTS.md'), `# pmem + Codex Integration

## Quick Start
\`\`\`bash
pmem session start -a "Codex"
pmem recall --format compact --budget 2000
\`\`\`

## Memory-Aware Workflow
1. Start task: \`pmem ask "<task description>" --format compact\`
2. Edit code
3. Inspect changes: \`pmem status --format json\`
4. Mark changes: \`pmem mark-dirty --auto\`
5. Get suggestions: \`pmem update --suggest --format json\`
6. Treat exit code 1 from suggest commands as "action suggested", not failure
7. Apply: \`pmem update --confirm -s "<what changed>" -n "<next step>"\`
8. End session: \`pmem session end -s "<summary>" && pmem verify\`

## Source Of Truth
Markdown cards under \`.pmem/\` are canonical. \`.pmem/pmem.db\` is a rebuildable SQLite runtime index.
`);
    // Write AGENTS.md in project root
    (0, fs_1.writeFile)(path.join(cwd, 'AGENTS.md'), AGENTS_MD);
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
    if (guidedInfo) {
        const mode = options.guided && !options.description && !options.stage && !options.next && !options.answers
            ? 'interactive' : 'non-interactive';
        console.log(`\nGuided setup (${mode}) complete. Run \`pmem recall\` to see your project state.`);
    }
    else {
        console.log(`\nNext: run \`pmem recall\` to see your project state, or \`pmem init --guided\` for interactive setup.`);
    }
}
function replaceTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
}
//# sourceMappingURL=init.js.map