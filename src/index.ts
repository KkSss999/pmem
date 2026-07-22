#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initCommand } from './commands/init';
import { rebuildCommand } from './commands/rebuild';
import { recallCommand } from './commands/recall';
import { verifyCommand } from './commands/verify';
import { askCommand } from './commands/ask';
import { relatedCommand, traceCommand } from './commands/graph';
import { updateCommand, markDirtyCommand } from './commands/update';
import { discoverCommand } from './core/discover';
import { integrationCommand } from './commands/integration';
import { migrateCommand } from './commands/migrate';
import { distillCommand } from './commands/distill';
import { sessionStartCommand, sessionEndCommand } from './commands/session';
import { statusCommand } from './commands/status';
import { installCommand } from './commands/install';
import { doctorCommand } from './commands/doctor';
import { renameCommand } from './commands/rename';
import { newCommand } from './commands/new';
import { syncCommand } from './commands/sync';
import { milestoneCommand } from './commands/milestone';
import { mcpCommand } from './commands/mcp';
import { contextCommand } from './commands/context';
import { captureCommand } from './commands/capture';
import { moduleInferCommand } from './commands/module';
import { decisionInferCommand } from './commands/decision';
import { relationsCommand } from './commands/relations';


const program = new Command();

// Read version dynamically from package.json (single source of truth)
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

program
  .name('pmem')
  .description('Project Memory for AI Agents — graph-based project memory runtime')
  .version(pkg.version);

program
  .command('status')
  .description('Detect changed files and affected memory cards')
  .option('-s, --since <timestamp>', 'Check changes since timestamp')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action(async (options) => {
    await statusCommand({ since: options.since, format: options.format });
  });

program
  .command('context <task>')
  .description('Retrieve consolidated context for a given task')
  .option('-b, --budget <tokens>', 'Token budget for context retrieval', '4000')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action(async (task: string, options) => {
    await contextCommand(task, { budget: options.budget ? parseInt(options.budget, 10) : undefined, format: options.format });
  });

program
  .command('capture')
  .description('Capture memory updates after task completion')
  .option('--auto', 'Auto-capture: detect changes and create a summary trace automatically')
  .option('-s, --summary <text>', 'Summary of changes')
  .option('-n, --next <text>', 'Recommended next step')
  .option('--full', 'Force a full rebuild of the database index after capture', false)
  .option('--force', 'Force capture write even if no files changed or diff hash is duplicate', false)
  .action(async (options) => {
    await captureCommand({
      auto: options.auto,
      summary: options.summary,
      next: options.next,
      full: options.full,
      force: options.force
    });
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
  .action((projectName?: string, options?: { guided?: boolean; description?: string; stage?: string; next?: string; answers?: string; domain?: string }) => {
    const opts = options || {};
    initCommand({
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
  .option('--recent <count>', 'Number of recent traces to read', '5')
  .option('--no-traces', 'Do not load recent traces')
  .option('--mode <mode>', 'Recall mode (brief, normal, deep)', 'normal')
  .action(async (options) => {
    await recallCommand(parseInt(options.budget, 10), options.format, options.since, {
      recent: options.recent ? parseInt(options.recent, 10) : undefined,
      noTraces: options.traces === false,
      mode: ['brief', 'normal', 'deep'].includes(options.mode) ? options.mode : 'normal'
    });
  });

program
  .command('ask <query>')
  .description('Hybrid memory recall (multi-channel + graph + scoring)')
  .option('-f, --format <format>', 'Output format (compact, json, paths, pack)', 'compact')
  .option('--explain', 'Show per-result reasons and scoring factors')
  .option('--limit <n>', 'Max results to return', '20')
  .action(async (query: string, options) => {
    const parsedLimit = options.limit ? parseInt(options.limit, 10) : undefined;
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      console.error('Error: --limit must be a positive integer.');
      process.exit(2);
    }
    await askCommand(query, options.format, {
      explain: options.explain === true,
      limit: parsedLimit,
    });
  });

program
  .command('related <id>')
  .description('Query graph neighbors')
  .option('-d, --depth <n>', 'Traversal depth (1 = direct only)', '1')
  .option('-t, --type <type>', 'Filter by edge type (e.g. depends_on)')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .option('--source <source>', 'Filter by edge source (explicit, inferred, mention, all)', 'all')
  .action(async (id: string, options) => {
    await relatedCommand(id, {
      depth: parseInt(options.depth, 10),
      type: options.type,
      format: options.format,
      source: options.source,
    });
  });

program
  .command('trace <id>')
  .description('Trace evidence for a node')
  .action((id: string) => {
    traceCommand(id);
  });

program
  .command('relations <id>')
  .description('List all relations for a card (grouped by direction; useful for too_many_relations triage)')
  .option('-t, --type <type>', 'Filter by edge type (e.g. depends_on)')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .option('--source <source>', 'Filter by edge source (explicit, inferred, mention, manual, all)', 'all')
  .option('--limit <n>', 'Limit edges per direction (default: all)')
  .action(async (id: string, options) => {
    await relationsCommand(id, {
      type: options.type,
      format: options.format,
      source: options.source,
      limit: options.limit ? parseInt(options.limit, 10) : undefined
    });
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
  .option('--replace-managed-blocks', 'Replace ## Why / ## Needed Context sections in next.md (destructive; default is to preserve)')
  .action((options) => {
    updateCommand(options);
  });

program
  .command('sync')
  .description('One-click sync: scan status, auto mark dirty, and run confirm update')
  .option('-s, --summary <text>', 'Summary of changes')
  .option('-n, --next <text>', 'Next step description')
  .action((options) => {
    syncCommand({ summary: options.summary, next: options.next });
  });

program
  .command('milestone <version>')
  .description('Record a release milestone in project memory')
  .option('-m, --message <text>', 'Description of the milestone')
  .option('--tag <name>', 'Git tag name (default: v<version>)')
  .action((version: string, options) => {
    milestoneCommand(version, { message: options.message, tag: options.tag });
  });

program
  .command('mark-dirty')
  .description('Mark memory as potentially stale')
  .option('-r, --reason <reason>', 'Reason for marking dirty', 'code_changed')
  .option('--auto', 'Auto-detect changed files and mark related cards dirty')
  .option('--card <id...>', 'Mark specific cards as dirty (space-separated, repeatable)')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action((options) => {
    markDirtyCommand(options.reason, {
      auto: options.auto,
      cardIds: options.card,
      format: options.format,
    });
  });

program
  .command('rebuild')
  .description('Rebuild SQLite indexes from source cards')
  .option('--changed', 'Incremental rebuild (hash comparison, default)')
  .option('--full', 'Full rebuild (clear all tables first)')
  .option('--card <id>', 'Rebuild a single card by ID')
  .action((options) => {
    rebuildCommand({
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
    discoverCommand({
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
    verifyCommand({ fix: options.fix, fixLocks: options.fixLocks, fixStale: options.fixStale, relaxed: options.relaxed });
  });

program
  .command('doctor')
  .description('Run diagnostic checks on project memory setup')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action((options) => {
    doctorCommand(options.format);
  });

program
  .command('migrate')
  .description('Migrate project memory to a newer schema version')
  .option('--to <version>', 'Target schema version', '0.3')
  .option('--dry-run', 'Preview migration without applying changes')
  .option('--backup', 'Create backup before migrating', true)
  .action((options) => {
    migrateCommand({ to: options.to, dryRun: options.dryRun, backup: options.backup });
  });

program
  .command('distill')
  .description('Consolidate trace files into stable memory cards')
  .option('--suggest', 'Suggest memory distillation (dry-run, default behavior)')
  .option('--confirm', 'Apply distillation changes')
  .option('--apply-suggestion <id>', 'Apply distillation for a specific target card')
  .option('--suggest-splits', 'Suggest splitting oversized cards')
  .action((options) => {
    distillCommand({ confirm: options.confirm, applySuggestion: options.applySuggestion, suggestSplits: options.suggestSplits });
  });

const session = program
  .command('session')
  .description('Manage development sessions');

session
  .command('start')
  .description('Start a new development session')
  .option('-a, --agent <name>', 'Agent name')
  .action((options) => {
    sessionStartCommand(options.agent);
  });

session
  .command('end')
  .description('End the current development session')
  .option('-s, --summary <text>', 'Task summary')
  .action((options) => {
    sessionEndCommand(options.summary);
  });

const integration = program
  .command('integration')
  .description('Manage agent framework integrations');

integration
  .command('list')
  .description('List active integrations')
  .action(() => {
    integrationCommand('list');
  });

integration
  .command('install <framework>')
  .description('Install integration for a framework')
  .action((framework: string) => {
    integrationCommand('install', framework);
  });

integration
  .command('verify')
  .description('Verify integration setup')
  .action(() => {
    integrationCommand('verify');
  });

program
  .command('install')
  .description('Install pmem skills or agent guidelines/rules')
  .option('--skills', 'Install skill files')
  .option('--agent-rules', 'Install agent guidelines/rules files (AGENTS.md, etc.)')
  .option('--claude', 'Target Claude Code')
  .option('--codex', 'Target Codex')
  .option('--gemini', 'Target Gemini CLI')
  .option('--cursor', 'Target Cursor (.cursor/rules/pmem.mdc)')
  .option('--cline', 'Target Cline (.clinerules/pmem.md)')
  .option('--aider', 'Target Aider (CONVENTIONS.md)')
  .option('--windsurf', 'Target Windsurf (.windsurfrules)')
  .option('--all', 'Target all detected agents')
  .action((options) => {
    installCommand({
      skills: options.skills,
      agentRules: options.agentRules,
      claude: options.claude,
      codex: options.codex,
      gemini: options.gemini,
      cursor: options.cursor,
      cline: options.cline,
      aider: options.aider,
      windsurf: options.windsurf,
      all: options.all,
    });
  });


program
  .command('new <type> <title>')
  .description('Create a new memory card with frontmatter template')
  .action((type: string, title: string) => {
    newCommand(type, title);
  });

program
  .command('rename')
  .description('Preview or apply batch text replacement in memory card bodies')
  .requiredOption('--find <pattern>', 'Text to find in card bodies')
  .requiredOption('--replace <replacement>', 'Replacement text')
  .option('--write', 'Apply changes (default is dry-run preview only)', false)
  .action((options) => {
    renameCommand({ find: options.find, replace: options.replace, write: options.write });
  });

program
  .command('mcp')
  .description('Start stdio MCP server for agent tool integration')
  .option('--write <mode>', 'Write mode (readonly, append-only)', 'readonly')
  .action(async (options) => {
    if (options.write !== 'readonly' && options.write !== 'append-only') {
      console.error('Error: --write must be either "readonly" or "append-only"');
      process.exit(2);
    }
    await mcpCommand(options.write);
  });

const moduleCmd = program
  .command('module')
  .description('Manage project modules');

moduleCmd
  .command('infer')
  .description('Auto-infer software modules from codebase structure and files')
  .option('--write', 'Write inferred modules directly to .pmem/modules/', false)
  .option('--dry-run', 'Preview inferred modules without writing', false)
  .option('--coarse-attribution', 'Use directory-level source file attribution (legacy behavior)')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action((options) => {
    moduleInferCommand({
      write: options.write,
      dryRun: options.dryRun,
      coarseAttribution: options.coarseAttribution,
      format: options.format,
    });
  });

const decisionCmd = program
  .command('decision')
  .description('Manage project decisions');

decisionCmd
  .command('infer')
  .description('Auto-infer project decisions from traces')
  .option('--write', 'Write inferred decisions directly to .pmem/decisions/', false)
  .option('--from-traces', 'Infer decisions from traces', true)
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .option('-t, --threshold <n>', 'Minimum confidence threshold (0-1)', '0.3')
  .action((options) => {
    decisionInferCommand({
      write: options.write,
      fromTraces: options.fromTraces,
      format: options.format,
      threshold: options.threshold !== undefined ? parseFloat(options.threshold) : undefined,
    });
  });

program.parseAsync().catch((err) => {
  console.error(err?.message || err);
  process.exit(2);
});
