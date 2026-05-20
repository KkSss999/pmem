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

const program = new Command();

program
  .name('pmem')
  .description('Project Memory for AI Agents — graph-based project memory runtime')
  .version('0.2.0');

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
  .action((options) => {
    recallCommand(parseInt(options.budget, 10));
  });

program
  .command('ask <query>')
  .description('Graph-guided memory recall')
  .action((query: string) => {
    askCommand(query);
  });

program
  .command('related <id>')
  .description('Query graph neighbors')
  .action((id: string) => {
    relatedCommand(id);
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
  .option('--confirm', 'Confirm and write changes')
  .option('--force', 'Force write without confirmation')
  .option('-s, --summary <text>', 'Summary of changes')
  .option('-n, --next <text>', 'Next step description')
  .action((options) => {
    updateCommand(options);
  });

program
  .command('mark-dirty')
  .description('Mark memory as potentially stale')
  .option('-r, --reason <reason>', 'Reason for marking dirty', 'code_changed')
  .action((options) => {
    markDirtyCommand(options.reason);
  });

program
  .command('rebuild')
  .description('Rebuild all indexes from source cards')
  .action(() => {
    rebuildCommand();
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
