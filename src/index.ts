#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { rebuildCommand } from './commands/rebuild';
import { recallCommand } from './commands/recall';
import { verifyCommand } from './commands/verify';
import { askCommand } from './commands/ask';
import { relatedCommand, traceCommand } from './commands/graph';
import { updateCommand, markDirtyCommand } from './commands/update';
import { integrationCommand } from './commands/integration';
import { migrateCommand } from './commands/migrate';
import { distillCommand } from './commands/distill';
import { sessionStartCommand, sessionEndCommand } from './commands/session';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('pmem')
  .description('Project Memory for AI Agents — graph-based project memory runtime')
  .version('0.4.0-dev');

program
  .command('status')
  .description('Detect changed files and affected memory cards')
  .option('-s, --since <timestamp>', 'Check changes since timestamp')
  .option('-f, --format <format>', 'Output format (compact, json)', 'compact')
  .action((options) => {
    statusCommand({ since: options.since, format: options.format });
  });

program
  .command('init [project-name]')
  .description('Initialize pmem in the current project')
  .option('--guided', 'Interactive guided initialization (recommended)')
  .action((projectName?: string, options?: { guided?: boolean }) => {
    const opts = options || {};
    initCommand({ projectName, guided: opts.guided });
  });

program
  .command('recall')
  .description('Quick project recall')
  .option('-b, --budget <tokens>', 'Token budget for recall', '2000')
  .option('-f, --format <format>', 'Output format (compact, json, paths, pack)', 'compact')
  .action((options) => {
    recallCommand(parseInt(options.budget, 10), options.format);
  });

program
  .command('ask <query>')
  .description('Graph-guided memory recall')
  .option('-f, --format <format>', 'Output format (compact, json, paths, pack)', 'compact')
  .action((query: string, options) => {
    askCommand(query, options.format);
  });

program
  .command('related <id>')
  .description('Query graph neighbors')
  .option('-d, --depth <n>', 'Traversal depth (1 = direct only)', '1')
  .option('-t, --type <type>', 'Filter by edge type (e.g. depends_on)')
  .action((id: string, options) => {
    relatedCommand(id, { depth: parseInt(options.depth, 10), type: options.type });
  });

program
  .command('trace <id>')
  .description('Trace evidence for a node')
  .action((id: string) => {
    traceCommand(id);
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
  .action((options) => {
    updateCommand(options);
  });

program
  .command('mark-dirty')
  .description('Mark memory as potentially stale')
  .option('-r, --reason <reason>', 'Reason for marking dirty', 'code_changed')
  .option('--auto', 'Auto-detect changed files and mark related cards dirty')
  .action((options) => {
    markDirtyCommand(options.reason, { auto: options.auto });
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
  .command('verify')
  .description('Check memory consistency and freshness')
  .option('--fix', 'Auto-fix issues where possible')
  .action((options) => {
    verifyCommand({ fix: options.fix });
  });

program
  .command('migrate')
  .description('Migrate project memory to a newer schema version')
  .option('--to <version>', 'Target schema version', '0.2')
  .option('--dry-run', 'Preview migration without applying changes')
  .option('--backup', 'Create backup before migrating', true)
  .action((options) => {
    migrateCommand({ to: options.to, dryRun: options.dryRun, backup: options.backup });
  });

program
  .command('distill')
  .description('Consolidate trace files into stable memory cards')
  .option('--confirm', 'Apply distillation changes')
  .option('--suggest-splits', 'Suggest splitting oversized cards')
  .action((options) => {
    distillCommand({ confirm: options.confirm, suggestSplits: options.suggestSplits });
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

program.parse();
