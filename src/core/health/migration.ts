import * as path from 'node:path';
import { atomicWrite, copyFile, ensureDir, listFiles, readFile, withLock } from '../fs';
import { parseFrontmatter } from '../yaml';
import { isTrustLabel, validTrustLabelsMessage } from '../trustLabels';

const CLASSIFICATIONS = new Set(['fact', 'decision', 'assumption', 'plan', 'risk', 'question']);
const SENSITIVITIES = new Set(['public', 'internal', 'personal', 'confidential', 'secret']);
const SAFE_CLASSIFICATION_BY_TYPE: Record<string, string> = {
  decision: 'decision', task: 'plan', feature: 'plan', risk: 'risk', assumption: 'assumption',
};

export interface HealthMigrationOptions {
  apply?: boolean;
  trustLabel?: string;
  sensitivity?: string;
  classificationByType?: Record<string, string>;
  cwd?: string;
  afterApply?: () => void;
  afterRollback?: () => void;
}

export interface HealthMigrationCardPlan {
  id: string;
  type: string;
  file_path: string;
  add: Record<string, string>;
  unresolved: string[];
  reasons: string[];
}

export interface HealthMigrationResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  changed: number;
  unresolved: number;
  backup_path: string | null;
  cards: HealthMigrationCardPlan[];
}

export function parseClassificationByType(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  const result: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const [type, classification, extra] = pair.split('=').map(part => part.trim());
    if (!type || !classification || extra !== undefined || !CLASSIFICATIONS.has(classification)) {
      throw new Error(`Invalid classification mapping "${pair}". Use type=fact|decision|assumption|plan|risk|question.`);
    }
    result[type] = classification;
  }
  return result;
}

function validateOptions(options: HealthMigrationOptions): void {
  if (options.trustLabel && !isTrustLabel(options.trustLabel)) {
    throw new Error(`Invalid trust label "${options.trustLabel}". Valid values: ${validTrustLabelsMessage()}.`);
  }
  if (options.sensitivity && !SENSITIVITIES.has(options.sensitivity)) throw new Error(`Invalid sensitivity: ${options.sensitivity}`);
  for (const value of Object.values(options.classificationByType ?? {})) {
    if (!CLASSIFICATIONS.has(value)) throw new Error(`Invalid classification: ${value}`);
  }
}

function cardFiles(pmemPath: string): string[] {
  return listFiles(pmemPath, /\.md$/).filter(file =>
    !file.includes(`${path.sep}backups${path.sep}`) &&
    !file.includes(`${path.sep}skills${path.sep}`) &&
    !file.includes(`${path.sep}integrations${path.sep}`) &&
    !file.includes(`${path.sep}candidates${path.sep}`),
  );
}

export function planHealthMigration(pmemPath: string, options: HealthMigrationOptions): HealthMigrationResult {
  validateOptions(options);
  const cwd = options.cwd ?? path.dirname(pmemPath);
  const cards: HealthMigrationCardPlan[] = [];
  let scanned = 0;
  for (const file of cardFiles(pmemPath)) {
    const content = readFile(file);
    const parsed = content ? parseFrontmatter(content) : null;
    if (!parsed || typeof parsed.data.id !== 'string' || typeof parsed.data.type !== 'string') continue;
    if (parsed.data.type === 'trace') continue;
    scanned++;
    const add: Record<string, string> = {};
    const unresolved: string[] = [];
    const reasons: string[] = [];
    if (!parsed.data.classification) {
      const inferred = options.classificationByType?.[parsed.data.type] ?? SAFE_CLASSIFICATION_BY_TYPE[parsed.data.type];
      if (inferred) {
        add.classification = inferred;
        reasons.push(options.classificationByType?.[parsed.data.type]
          ? `classification explicitly mapped from card type ${parsed.data.type}`
          : `classification inferred from unambiguous card type ${parsed.data.type}`);
      } else unresolved.push('classification');
    }
    if (!parsed.data.trust_label) {
      if (options.trustLabel) {
        add.trust_label = options.trustLabel;
        reasons.push('trust_label explicitly selected by operator');
      } else unresolved.push('trust_label');
    }
    if (!parsed.data.sensitivity) {
      if (options.sensitivity) {
        add.sensitivity = options.sensitivity;
        reasons.push('sensitivity explicitly selected by operator');
      } else unresolved.push('sensitivity');
    }
    if (Object.keys(add).length > 0 || unresolved.length > 0) {
      cards.push({
        id: parsed.data.id,
        type: parsed.data.type,
        file_path: path.relative(cwd, file),
        add,
        unresolved,
        reasons,
      });
    }
  }
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    scanned,
    changed: cards.filter(card => Object.keys(card.add).length > 0).length,
    unresolved: cards.filter(card => card.unresolved.length > 0).length,
    backup_path: null,
    cards,
  };
}

function insertTopLevelFields(content: string, fields: Record<string, string>): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('Card has invalid frontmatter');
  const additions = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
  if (!additions) return content;
  return content.replace(/^---\n([\s\S]*?)\n---/, `---\n${match[1].trimEnd()}\n${additions}\n---`);
}

export function applyHealthMigration(pmemPath: string, options: HealthMigrationOptions): HealthMigrationResult {
  if (!options.apply) return planHealthMigration(pmemPath, options);
  validateOptions(options);
  const cwd = options.cwd ?? path.dirname(pmemPath);
  const result = withLock(pmemPath, () => {
    const plan = planHealthMigration(pmemPath, options);
    if (plan.unresolved > 0) {
      throw new Error(`Migration has ${plan.unresolved} card(s) with unresolved metadata. Provide --trust-label, --sensitivity, and --classification-by-type mappings shown by the dry-run.`);
    }
    const changed = plan.cards.filter(card => Object.keys(card.add).length > 0);
    if (changed.length === 0) return plan;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(pmemPath, 'backups', `${stamp}-before-health-migration`);
    const originals = new Map<string, string>();
    try {
      for (const card of changed) {
        const file = path.join(cwd, card.file_path);
        const content = readFile(file);
        if (content === null) throw new Error(`Card disappeared during migration: ${card.file_path}`);
        originals.set(file, content);
        const destination = path.join(backupPath, path.relative(pmemPath, file));
        ensureDir(path.dirname(destination));
        copyFile(file, destination);
      }
      for (const card of changed) {
        const file = path.join(cwd, card.file_path);
        atomicWrite(file, insertTopLevelFields(originals.get(file)!, card.add));
      }
      options.afterApply?.();
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const [file, content] of originals) {
        try { atomicWrite(file, content); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      try { options.afterRollback?.(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'Health migration failed and rollback could not fully restore Markdown and derived indexes. Restore from the reported backup, then run `pmem rebuild`.');
      }
      throw error;
    }
    return { ...plan, backup_path: path.relative(cwd, backupPath) };
  }, { timeoutMs: 30000, onTimeout: 'error' });
  if (!result) throw new Error('Health migration was skipped because the pmem lock is active.');
  return result;
}
