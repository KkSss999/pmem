/**
 * Markdown Projection for the v1.3 memory runtime.
 *
 * Markdown is a bidirectional projection, not the canonical store.  A
 * projection write is made durable with a journal + temp-file + rename
 * protocol, but this module intentionally does not claim an ACID transaction
 * across SQLite (or another backend) and the filesystem.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as yaml from 'js-yaml';
import {
  recordToV12Card,
  v12CardToRecord,
  type CanonicalMemoryRecordCandidate,
} from '../compatibility/v1_2';
import type { BackendTransaction, MemoryBackend } from '../runtime/model';

export const MARKDOWN_PROJECTION_PROTOCOL = 'v1';
/** Explicit contract marker: filesystem projection is not cross-backend ACID. */
export const CROSS_STORE_ATOMICITY = 'journaled-filesystem-only';

export type ProjectionJournalState =
  | 'prepared'
  | 'temp_written'
  | 'backup_created'
  | 'published'
  | 'recovered'
  | 'rollback_failed';

export interface ProjectionJournal {
  protocol: typeof MARKDOWN_PROJECTION_PROTOCOL;
  operationId: string;
  targetPath: string;
  tempPath: string;
  backupPath?: string;
  state: ProjectionJournalState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface MarkdownProjectionOptions {
  /** Optional stable journal path; defaults to `<target>.projection.journal.json`. */
  journalPath?: string;
  /** Test/failure-injection hooks; production callers normally omit these. */
  hooks?: {
    beforeBackup?: () => void;
    beforePublish?: () => void;
    afterPublish?: () => void;
  };
}

export interface ProjectionWriteResult {
  targetPath: string;
  journalPath: string;
  state: ProjectionJournalState;
  recovered: boolean;
}

export interface MarkdownRebuildError {
  filePath: string;
  message: string;
}

export interface MarkdownRebuildOptions {
  /** Optional backend transaction target; without it this is a read-only import. */
  backend?: MemoryBackend;
  /** Caller-owned transaction for composing a larger Runtime write. */
  transaction?: BackendTransaction;
  /** Commit valid records even when some files are malformed. Defaults false. */
  allowPartial?: boolean;
  /** Correlation/principal context for a transaction opened by this function. */
  principal?: string;
}

export interface MarkdownRebuildResult {
  scanned: number;
  imported: number;
  records: readonly CanonicalMemoryRecordCandidate[];
  errors: readonly MarkdownRebuildError[];
  committed: boolean;
  rolledBack: boolean;
}

export class MarkdownProjectionError extends Error {
  readonly code: 'INVALID_MARKDOWN' | 'INVALID_JOURNAL' | 'IO_ERROR' | 'RECOVERY_FAILED';
  readonly filePath?: string;

  constructor(
    code: MarkdownProjectionError['code'],
    message: string,
    filePath?: string,
  ) {
    super(message);
    this.name = 'MarkdownProjectionError';
    this.code = code;
    this.filePath = filePath;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePath(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MarkdownProjectionError('IO_ERROR', `${field} must be a non-empty path.`, value);
  }
  return value;
}

function journalPathFor(targetPath: string, options?: MarkdownProjectionOptions): string {
  return options?.journalPath ?? `${targetPath}.projection.journal.json`;
}

function fsyncDirectory(directory: string): void {
  // Directory fsync is supported on POSIX.  Some platforms/filesystems reject
  // opening a directory; rename has still completed, so this is best effort.
  try {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {
    // Deliberately ignored: durability is still protected by journal state.
  }
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function writeJournal(journalPath: string, journal: ProjectionJournal): void {
  writeAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
}

function readJournal(journalPath: string): ProjectionJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error: any) {
    throw new MarkdownProjectionError('INVALID_JOURNAL', `Cannot read projection journal: ${error?.message ?? String(error)}`, journalPath);
  }
  if (!isRecord(parsed) || parsed.protocol !== MARKDOWN_PROJECTION_PROTOCOL ||
      typeof parsed.operationId !== 'string' || typeof parsed.targetPath !== 'string' ||
      typeof parsed.tempPath !== 'string' || typeof parsed.state !== 'string' ||
      typeof parsed.createdAt !== 'string' || typeof parsed.updatedAt !== 'string') {
    throw new MarkdownProjectionError('INVALID_JOURNAL', 'Projection journal is malformed or uses an unknown protocol.', journalPath);
  }
  const states: ProjectionJournalState[] = ['prepared', 'temp_written', 'backup_created', 'published', 'recovered', 'rollback_failed'];
  if (!states.includes(parsed.state as ProjectionJournalState)) {
    throw new MarkdownProjectionError('INVALID_JOURNAL', `Unknown projection journal state '${String(parsed.state)}'.`, journalPath);
  }
  return parsed as unknown as ProjectionJournal;
}

function updateJournal(journalPath: string, journal: ProjectionJournal, state: ProjectionJournalState, error?: string): ProjectionJournal {
  const updated: ProjectionJournal = {
    ...journal,
    state,
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  writeJournal(journalPath, updated);
  return updated;
}

function parseMarkdown(content: string, filePath: string): CanonicalMemoryRecordCandidate {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    throw new MarkdownProjectionError('INVALID_MARKDOWN', 'Markdown projection is missing YAML frontmatter delimiters.', filePath);
  }
  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(match[1]);
  } catch (error: any) {
    throw new MarkdownProjectionError('INVALID_MARKDOWN', `Invalid YAML frontmatter: ${error?.message ?? String(error)}`, filePath);
  }
  if (!isRecord(frontmatter)) {
    throw new MarkdownProjectionError('INVALID_MARKDOWN', 'Markdown frontmatter must be a YAML object.', filePath);
  }
  try {
    return v12CardToRecord({ frontmatter, body: match[2], filePath });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MarkdownProjectionError('INVALID_MARKDOWN', detail, filePath);
  }
}

export function importMarkdownRecord(filePath: string): CanonicalMemoryRecordCandidate {
  requirePath(filePath, 'filePath');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error: any) {
    throw new MarkdownProjectionError('IO_ERROR', `Cannot read Markdown projection: ${error?.message ?? String(error)}`, filePath);
  }
  return parseMarkdown(content, filePath);
}

function markdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(child);
  }
  return files.sort();
}

/**
 * Rebuild canonical records from a Markdown projection tree. Invalid cards are
 * reported with paths. When a backend/transaction is supplied, valid records
 * are written atomically and the transaction is rolled back on any error by
 * default; this remains a backend transaction, not cross-store ACID.
 */
export async function rebuildMarkdownProjection(
  directory: string,
  options: MarkdownRebuildOptions = {},
): Promise<MarkdownRebuildResult> {
  requirePath(directory, 'directory');
  const files = markdownFiles(path.resolve(directory));
  const records: CanonicalMemoryRecordCandidate[] = [];
  const errors: MarkdownRebuildError[] = [];
  for (const filePath of files) {
    try {
      records.push(importMarkdownRecord(filePath));
    } catch (error) {
      errors.push({ filePath, message: error instanceof Error ? error.message : String(error) });
    }
  }

  let transaction = options.transaction;
  let ownedTransaction = false;
  if (!transaction && options.backend) {
    transaction = await options.backend.beginTransaction({
      correlation_id: `markdown-rebuild:${Date.now()}`,
      principal: options.principal,
    });
    ownedTransaction = true;
  }
  if (!transaction) {
    return { scanned: files.length, imported: records.length, records, errors, committed: false, rolledBack: false };
  }

  const shouldRollback = errors.length > 0 && options.allowPartial !== true;
  try {
    if (shouldRollback) {
      await transaction.rollback(errors);
      return { scanned: files.length, imported: records.length, records, errors, committed: false, rolledBack: true };
    }
    for (const record of records) await transaction.putRecord(record);
    await transaction.commit();
    return { scanned: files.length, imported: records.length, records, errors, committed: true, rolledBack: false };
  } catch (error) {
    if (ownedTransaction || options.transaction) {
      try { await transaction.rollback(error); } catch (rollbackError) {
        errors.push({ filePath: path.resolve(directory), message: `rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}` });
      }
    }
    errors.push({ filePath: path.resolve(directory), message: error instanceof Error ? error.message : String(error) });
    return { scanned: files.length, imported: records.length, records, errors, committed: false, rolledBack: true };
  }
}

export function serializeMarkdownRecord(record: unknown, filePathOverride?: string): string {
  let card;
  try {
    card = recordToV12Card(record, filePathOverride);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MarkdownProjectionError('INVALID_MARKDOWN', detail, filePathOverride);
  }
  const frontmatter = yaml.dump(card.frontmatter, { noRefs: true, lineWidth: 120, sortKeys: false });
  return `---\n${frontmatter.trimEnd()}\n---\n${card.body}`;
}

/**
 * Publish one Markdown projection using a journaled temp + rename protocol.
 * Existing content is moved aside before publication so failures can restore
 * the previous projection.  The journal remains only when recovery itself
 * fails, making the unresolved state visible to health checks.
 */
export function exportMarkdownRecord(
  record: unknown,
  targetPath: string,
  options: MarkdownProjectionOptions = {},
): ProjectionWriteResult {
  requirePath(targetPath, 'targetPath');
  const absoluteTarget = path.resolve(targetPath);
  const journalPath = path.resolve(journalPathFor(absoluteTarget, options));
  const operationId = crypto.randomUUID();
  const tempPath = `${absoluteTarget}.tmp.${process.pid}.${operationId}`;
  const backupPath = `${absoluteTarget}.bak.${operationId}`;
  const content = serializeMarkdownRecord(record, absoluteTarget);
  let journal: ProjectionJournal = {
    protocol: MARKDOWN_PROJECTION_PROTOCOL,
    operationId,
    targetPath: absoluteTarget,
    tempPath,
    backupPath: fs.existsSync(absoluteTarget) ? backupPath : undefined,
    state: 'prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeJournal(journalPath, journal);
  try {
    fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    journal = updateJournal(journalPath, journal, 'temp_written');

    options.hooks?.beforeBackup?.();
    if (journal.backupPath && fs.existsSync(absoluteTarget)) {
      fs.renameSync(absoluteTarget, journal.backupPath);
      fsyncDirectory(path.dirname(absoluteTarget));
      journal = updateJournal(journalPath, journal, 'backup_created');
    }

    options.hooks?.beforePublish?.();
    fs.renameSync(tempPath, absoluteTarget);
    fsyncDirectory(path.dirname(absoluteTarget));
    journal = updateJournal(journalPath, journal, 'published');
    options.hooks?.afterPublish?.();

    if (journal.backupPath) {
      try { fs.unlinkSync(journal.backupPath); } catch {}
    }
    try { fs.unlinkSync(journalPath); } catch {}
    return { targetPath: absoluteTarget, journalPath, state: 'published', recovered: false };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      if (journal.backupPath && fs.existsSync(journal.backupPath)) {
        if (fs.existsSync(absoluteTarget)) fs.unlinkSync(absoluteTarget);
        fs.renameSync(journal.backupPath, absoluteTarget);
        fsyncDirectory(path.dirname(absoluteTarget));
      }
      journal = updateJournal(journalPath, journal, 'recovered', detail);
    } catch (recoveryError: any) {
      journal = updateJournal(journalPath, journal, 'rollback_failed', `${detail}; recovery: ${recoveryError?.message ?? String(recoveryError)}`);
      throw new MarkdownProjectionError('RECOVERY_FAILED', `Projection publish failed and rollback failed: ${journal.error}`, absoluteTarget);
    }
    try { fs.unlinkSync(journalPath); } catch {}
    throw new MarkdownProjectionError('IO_ERROR', `Projection publish failed; previous content recovered: ${detail}`, absoluteTarget);
  }
}

/** Recover a journal left by a crashed process. Safe to call repeatedly. */
export function recoverMarkdownProjection(journalPath: string): ProjectionWriteResult {
  requirePath(journalPath, 'journalPath');
  const absoluteJournal = path.resolve(journalPath);
  const journal = readJournal(absoluteJournal);
  if (journal.state === 'published' || journal.state === 'recovered') {
    if (journal.backupPath && fs.existsSync(journal.backupPath)) {
      try { fs.unlinkSync(journal.backupPath); } catch {}
    }
    try { fs.unlinkSync(absoluteJournal); } catch {}
    return { targetPath: journal.targetPath, journalPath: absoluteJournal, state: journal.state, recovered: true };
  }

  try {
    if (fs.existsSync(journal.tempPath)) fs.unlinkSync(journal.tempPath);
    if (journal.backupPath && fs.existsSync(journal.backupPath)) {
      if (fs.existsSync(journal.targetPath)) fs.unlinkSync(journal.targetPath);
      fs.renameSync(journal.backupPath, journal.targetPath);
      fsyncDirectory(path.dirname(journal.targetPath));
    }
    const recovered = updateJournal(absoluteJournal, journal, 'recovered');
    try { fs.unlinkSync(absoluteJournal); } catch {}
    return { targetPath: recovered.targetPath, journalPath: absoluteJournal, state: 'recovered', recovered: true };
  } catch (error: any) {
    const detail = error?.message ?? String(error);
    updateJournal(absoluteJournal, journal, 'rollback_failed', detail);
    throw new MarkdownProjectionError('RECOVERY_FAILED', `Projection recovery failed: ${detail}`, journal.targetPath);
  }
}

export function inspectMarkdownProjectionJournal(journalPath: string): ProjectionJournal {
  return readJournal(path.resolve(requirePath(journalPath, 'journalPath')));
}
