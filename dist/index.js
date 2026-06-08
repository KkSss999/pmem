#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs_1 = require("fs");
const path_1 = require("path");
const init_1 = require("./commands/init");
const rebuild_1 = require("./commands/rebuild");
const recall_1 = require("./commands/recall");
const verify_1 = require("./commands/verify");
const ask_1 = require("./commands/ask");
const graph_1 = require("./commands/graph");
const update_1 = require("./commands/update");
const discover_1 = require("./core/discover");
const integration_1 = require("./commands/integration");
const migrate_1 = require("./commands/migrate");
const distill_1 = require("./commands/distill");
const session_1 = require("./commands/session");
const status_1 = require("./commands/status");
const install_1 = require("./commands/install");
const doctor_1 = require("./commands/doctor");
const rename_1 = require("./commands/rename");
const new_1 = require("./commands/new");
const sync_1 = require("./commands/sync");
const milestone_1 = require("./commands/milestone");
const program = new commander_1.Command();
// Read version dynamically from package.json (single source of truth)
const pkg = JSON.parse((0, fs_1.readFileSync)((0, path_1.resolve)(__dirname, '..', 'package.json'), 'utf-8'));
program
    .name('pmem')
    .description('Project Memory for AI Agents — graph-based project memory runtime')
    .version(pkg.version);
program
    .command('status')
    .description('Detect changed files and affected memory cards')
    .option('-s, --since <timestamp>', 'Check changes since timestamp')
    .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
    .action((options) => {
    (0, status_1.statusCommand)({ since: options.since, format: options.format });
});
program
    .command('init [project-name]')
    .description('Initialize pmem in the current project')
    .option('--guided', 'Interactive guided initialization (recommended)')
    .option('--description <text>', 'Project description (non-interactive mode)')
    .option('--stage <text>', 'Current project stage (non-interactive mode)')
    .option('--next <text>', 'Most important next step (non-interactive mode)')
    .option('--answers <path>', 'Path to JSON answers file for non-interactive init')
    .option('--domain <type>', 'Domain preset for the project (software, novel, research)', 'software')
    .action((projectName, options) => {
    const opts = options || {};
    (0, init_1.initCommand)({
        projectName,
        guided: opts.guided,
        description: opts.description,
        stage: opts.stage,
        next: opts.next,
        answers: opts.answers,
        domain: opts.domain,
    });
});
program
    .command('recall')
    .description('Quick project recall')
    .option('-b, --budget <tokens>', 'Token budget for recall', '2000')
    .option('-f, --format <format>', 'Output format (compact, json, paths, pack)', 'compact')
    .option('--since <duration>', 'Only show cards updated within duration (e.g. 7d, 24h, 1w)')
    .action((options) => {
    (0, recall_1.recallCommand)(parseInt(options.budget, 10), options.format, options.since);
});
program
    .command('ask <query>')
    .description('Graph-guided memory recall')
    .option('-f, --format <format>', 'Output format (compact, json, paths, pack)', 'compact')
    .action((query, options) => {
    (0, ask_1.askCommand)(query, options.format);
});
program
    .command('related <id>')
    .description('Query graph neighbors')
    .option('-d, --depth <n>', 'Traversal depth (1 = direct only)', '1')
    .option('-t, --type <type>', 'Filter by edge type (e.g. depends_on)')
    .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
    .option('--source <source>', 'Filter by edge source (explicit, inferred, mention, all)', 'all')
    .action((id, options) => {
    (0, graph_1.relatedCommand)(id, {
        depth: parseInt(options.depth, 10),
        type: options.type,
        format: options.format,
        source: options.source,
    });
});
program
    .command('trace <id>')
    .description('Trace evidence for a node')
    .action((id) => {
    (0, graph_1.traceCommand)(id);
});
program
    .command('update')
    .description('Update project memory')
    .option('--auto', 'Auto-detect changes, generate suggestions')
    .option('--suggest', 'Suggest memory updates based on dirty flags and changes')
    .option('--apply-suggestion <id>', 'Apply a specific suggestion by ID')
    .option('--confirm', 'Confirm and write changes')
    .option('--force', 'Force write without confirmation')
    .option('-s, --summary <text>', 'Summary of changes')
    .option('-n, --next <text>', 'Next step description')
    .option('-f, --format <format>', 'Output format for --suggest (compact, json)', 'compact')
    .option('--include-history', 'Include historical dirty flags in suggestion output')
    .option('--accept-edges <ids>', 'Comma-separated edge IDs to accept (upgrade to explicit)')
    .option('--reject-edges <ids>', 'Comma-separated edge IDs to reject (delete)')
    .option('--refresh-verified <ids>', 'Comma-separated card IDs to refresh last_verified timestamps')
    .action((options) => {
    (0, update_1.updateCommand)(options);
});
program
    .command('sync')
    .description('One-click sync: scan status, auto mark dirty, and run confirm update')
    .option('-s, --summary <text>', 'Summary of changes')
    .option('-n, --next <text>', 'Next step description')
    .action((options) => {
    (0, sync_1.syncCommand)({ summary: options.summary, next: options.next });
});
program
    .command('milestone <version>')
    .description('Record a release milestone in project memory')
    .option('-m, --message <text>', 'Description of the milestone')
    .option('--tag <name>', 'Git tag name (default: v<version>)')
    .action((version, options) => {
    (0, milestone_1.milestoneCommand)(version, { message: options.message, tag: options.tag });
});
program
    .command('mark-dirty')
    .description('Mark memory as potentially stale')
    .option('-r, --reason <reason>', 'Reason for marking dirty', 'code_changed')
    .option('--auto', 'Auto-detect changed files and mark related cards dirty')
    .option('--card <id...>', 'Mark specific cards as dirty (space-separated, repeatable)')
    .action((options) => {
    (0, update_1.markDirtyCommand)(options.reason, { auto: options.auto, cardIds: options.card });
});
program
    .command('rebuild')
    .description('Rebuild SQLite indexes from source cards')
    .option('--changed', 'Incremental rebuild (hash comparison, default)')
    .option('--full', 'Full rebuild (clear all tables first)')
    .option('--card <id>', 'Rebuild a single card by ID')
    .action((options) => {
    (0, rebuild_1.rebuildCommand)({
        changed: options.changed,
        full: options.full,
        card: options.card,
    });
});
program
    .command('discover')
    .description('Auto-discover project relationships (tech stack, file deps, imports)')
    .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
    .option('--dry-run', 'Preview discoveries without writing to database')
    .option('--min-confidence <n>', 'Minimum confidence threshold (0-1)', '0.5')
    .option('--lang <languages>', 'Languages to scan (auto, or comma-separated: nodejs,python,rust,go,cpp,java)', 'auto')
    .option('--pattern-file <path>', 'Path to custom language pattern JSON file')
    .action((options) => {
    (0, discover_1.discoverCommand)({
        format: options.format,
        dryRun: options.dryRun,
        minConfidence: parseFloat(options.minConfidence),
        lang: options.lang,
        patternFile: options.patternFile,
    });
});
program
    .command('verify')
    .description('Check memory consistency and freshness')
    .option('--fix', 'Auto-fix issues where possible')
    .option('--fix-locks', 'Clean stale lock at .pmem/.lock')
    .option('--fix-stale', 'Auto-fix stale memory warning by updating verification timestamps')
    .option('--relaxed', 'Temporarily double all card_policy.max_tokens limits')
    .action((options) => {
    (0, verify_1.verifyCommand)({ fix: options.fix, fixLocks: options.fixLocks, fixStale: options.fixStale, relaxed: options.relaxed });
});
program
    .command('doctor')
    .description('Run diagnostic checks on project memory setup')
    .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
    .action((options) => {
    (0, doctor_1.doctorCommand)(options.format);
});
program
    .command('migrate')
    .description('Migrate project memory to a newer schema version')
    .option('--to <version>', 'Target schema version', '0.3')
    .option('--dry-run', 'Preview migration without applying changes')
    .option('--backup', 'Create backup before migrating', true)
    .action((options) => {
    (0, migrate_1.migrateCommand)({ to: options.to, dryRun: options.dryRun, backup: options.backup });
});
program
    .command('distill')
    .description('Consolidate trace files into stable memory cards')
    .option('--suggest', 'Suggest memory distillation (dry-run, default behavior)')
    .option('--confirm', 'Apply distillation changes')
    .option('--apply-suggestion <id>', 'Apply distillation for a specific target card')
    .option('--suggest-splits', 'Suggest splitting oversized cards')
    .action((options) => {
    (0, distill_1.distillCommand)({ confirm: options.confirm, applySuggestion: options.applySuggestion, suggestSplits: options.suggestSplits });
});
const session = program
    .command('session')
    .description('Manage development sessions');
session
    .command('start')
    .description('Start a new development session')
    .option('-a, --agent <name>', 'Agent name')
    .action((options) => {
    (0, session_1.sessionStartCommand)(options.agent);
});
session
    .command('end')
    .description('End the current development session')
    .option('-s, --summary <text>', 'Task summary')
    .action((options) => {
    (0, session_1.sessionEndCommand)(options.summary);
});
const integration = program
    .command('integration')
    .description('Manage agent framework integrations');
integration
    .command('list')
    .description('List active integrations')
    .action(() => {
    (0, integration_1.integrationCommand)('list');
});
integration
    .command('install <framework>')
    .description('Install integration for a framework')
    .action((framework) => {
    (0, integration_1.integrationCommand)('install', framework);
});
integration
    .command('verify')
    .description('Verify integration setup')
    .action(() => {
    (0, integration_1.integrationCommand)('verify');
});
program
    .command('install')
    .description('Install pmem skills to agent global directories')
    .option('--skills', 'Install skill files')
    .option('--claude', 'Target Claude Code')
    .option('--codex', 'Target Codex')
    .option('--gemini', 'Target Gemini CLI')
    .option('--all', 'Target all detected agents')
    .action((options) => {
    (0, install_1.installCommand)({
        skills: options.skills,
        claude: options.claude,
        codex: options.codex,
        gemini: options.gemini,
        all: options.all,
    });
});
program
    .command('new <type> <title>')
    .description('Create a new memory card with frontmatter template')
    .action((type, title) => {
    (0, new_1.newCommand)(type, title);
});
program
    .command('rename')
    .description('Preview or apply batch text replacement in memory card bodies')
    .requiredOption('--find <pattern>', 'Text to find in card bodies')
    .requiredOption('--replace <replacement>', 'Replacement text')
    .option('--write', 'Apply changes (default is dry-run preview only)', false)
    .action((options) => {
    (0, rename_1.renameCommand)({ find: options.find, replace: options.replace, write: options.write });
});
program.parse();
//# sourceMappingURL=index.js.map