import * as path from 'path';
import { isTrustLabel, validTrustLabelsMessage } from './trustLabels';
import { statSync } from 'fs';
import { fileExists, readFile } from './fs';
import { openDatabase } from './db';
import { parseFrontmatter } from './yaml';
import type { ConsistencyIssue, CardRow } from '../types';

/**
 * Check for stale memory: cards whose source_files have been modified
 * after the card was last updated or verified.
 *
 * Shared between verify.ts and update.ts so that verify/suggest
 * semantics stay aligned.
 */
export function checkStaleMemory(pmemPath: string): ConsistencyIssue[] {
  const cwd = path.dirname(pmemPath);
  const dbPath = path.join(pmemPath, 'pmem.db');

  if (!fileExists(dbPath)) {
    return [];
  }

  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase(pmemPath);
  } catch {
    return [];
  }

  const issues: ConsistencyIssue[] = [];

  try {
    const cards = db.prepare(
      'SELECT * FROM cards WHERE is_deleted = 0'
    ).all() as CardRow[];

    for (const card of cards) {
      if (card.type === 'trace') continue;
      const sourceFiles = db.prepare(
        "SELECT p.path FROM paths p WHERE p.card_id = ? AND p.relation = 'source_file'"
      ).all(card.id) as Array<{ path: string }>;

      const t1 = card.updated_at ? new Date(card.updated_at).getTime() : 0;
      const t2 = card.last_verified_at ? new Date(card.last_verified_at).getTime() : 0;
      const cardUpdatedMs = Math.max(t1, t2);
      if (cardUpdatedMs === 0) continue;

      const stalePaths: string[] = [];
      for (const sourceFile of sourceFiles) {
        // Skip .pmem/ self-references: pmem update --confirm rewrites
        // manifest.yml / next.md / state.md / index.md, which would
        // immediately trigger false-positive stale_memory on the next
        // verify for any card whose source_files list .pmem/ entries.
        if (sourceFile.path.startsWith('.pmem/') || sourceFile.path === '.pmem') continue;

        const absPath = path.join(cwd, sourceFile.path);
        if (!fileExists(absPath)) continue;
        try {
          const sourceStat = statSync(absPath);
          if (sourceStat.mtimeMs > cardUpdatedMs) {
            stalePaths.push(sourceFile.path);
          }
        } catch {
          // skip files that can't be stat'd
        }
      }
      if (stalePaths.length > 0) {
        stalePaths.sort();
        issues.push({
          type: 'stale_memory',
          severity: 'blocking',
          card_id: card.id,
          file_path: stalePaths[0],
          file_paths: stalePaths,
          evidence_count: stalePaths.length,
          message: stalePaths.length === 1
            ? `${card.id} may be stale — ${stalePaths[0]} modified after last card update`
            : `${card.id} may be stale — ${stalePaths.length} source files modified after last card update`,
        });
      }
    }
  } finally {
    // Don't close the DB — it may be reused by the caller
  }

  return issues;
}

/**
 * Check for cards with low confidence scores (< 0.4).
 */
export function checkLowConfidence(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];

  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }

  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const raw = parsed.data.confidence;
      if (raw === undefined || raw === null) continue;
      const confNum = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
      if (!isNaN(confNum) && confNum < 0.4) {
        issues.push({
          type: 'low_confidence',
          severity: 'warning',
          card_id: card.id,
          message: `${card.id} has low confidence (${confNum}). Consider reviewing or verifying this card.`,
        });
      }
    }
  } finally { /* Don't close DB — may be reused by caller */ }
  return issues;
}

/**
 * Check for cards missing a classification tag.
 */
export function checkUnclassifiedCard(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];

  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }

  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const classification = parsed.data.classification;
      if (!classification || (typeof classification === 'string' && classification.trim() === '')) {
        issues.push({
          type: 'unclassified_card',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} has no classification. Consider classifying as: fact, decision, assumption, plan, risk, question.`,
        });
      }
    }
  } finally { /* Don't close DB — may be reused by caller */ }
  return issues;
}

/**
 * Check for cards that reference a superseded decision via depends_on/related_to edges.
 */
export function checkSupersededReference(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];

  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }

  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    const supersededByMap = new Map<string, string>();
    for (const card of cards) {
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const supersededBy = parsed.data.superseded_by;
      if (supersededBy && typeof supersededBy === 'string' && supersededBy.trim() !== '') {
        supersededByMap.set(card.id, supersededBy.trim());
      }
    }
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const edges = db.prepare(
        "SELECT to_id, type FROM edges WHERE from_id = ? AND type IN ('depends_on', 'related_to')"
      ).all(card.id) as Array<{ to_id: string; type: string }>;
      for (const edge of edges) {
        if (supersededByMap.has(edge.to_id)) {
          issues.push({
            type: 'superseded_reference',
            severity: 'warning',
            card_id: card.id,
            message: `${card.id} references ${edge.to_id} via '${edge.type}', but ${edge.to_id} has been superseded by '${supersededByMap.get(edge.to_id)}'.`,
          });
        }
      }
    }
  } finally { /* Don't close DB — may be reused by caller */ }
  return issues;
}

/**
 * Check if .pmem/next.md hasn't been updated in over 14 days.
 */
export function checkStaleNextStep(pmemPath: string): ConsistencyIssue[] {
  const nextPath = path.join(pmemPath, 'next.md');
  if (!fileExists(nextPath)) return [];
  try {
    const stat = statSync(nextPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 14 * 24 * 60 * 60 * 1000) {
      const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000));
      return [{
        type: 'stale_next_step',
        severity: 'info',
        file_path: '.pmem/next.md',
        message: `.pmem/next.md was last updated ~${ageDays} days ago. The next step may be stale.`,
      }];
    }
  } catch { /* skip */ }
  return [];
}

/**
 * Check for cards sharing tags but with conflicting classifications.
 */
export function checkConflictingClassifications(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];

  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }

  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    const tagMap = new Map<string, Array<{ card_id: string; classification: string }>>();
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const classification = parsed.data.classification;
      if (!classification || typeof classification !== 'string' || classification.trim() === '') continue;
      const tags = parsed.data.tags;
      if (!tags || !Array.isArray(tags)) continue;
      for (const tag of tags) {
        if (typeof tag !== 'string') continue;
        const t = tag.toLowerCase().trim();
        if (!t) continue;
        if (!tagMap.has(t)) tagMap.set(t, []);
        tagMap.get(t)!.push({ card_id: card.id, classification: classification.trim() });
      }
    }
    for (const [tag, entries] of tagMap) {
      if (entries.length < 2) continue;
      const classes = new Set(entries.map(e => e.classification));
      if (classes.size < 2) continue;
      const cardList = entries.map(e => `${e.card_id} (${e.classification})`).join(', ');
      issues.push({
        type: 'conflicting_classifications',
        severity: 'info',
        message: `Tag "${tag}" has conflicting classifications: ${cardList}. Review for consistency.`,
      });
    }
  } finally { /* Don't close DB — may be reused by caller */ }
  return issues;
}

/**
 * Check for cards with trust_label and sensitivity issues.
 */
export function checkTrustLabels(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];
  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }
  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const trustLabel = parsed.data.trust_label;
      const sensitivity = parsed.data.sensitivity;
      if (!trustLabel || (typeof trustLabel === 'string' && trustLabel.trim() === '')) {
        issues.push({
          type: 'untrusted_memory',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} has no trust_label. Valid values: ${validTrustLabelsMessage()}.`,
        });
      } else if (!isTrustLabel(trustLabel)) {
        issues.push({
          type: 'invalid_trust_label',
          severity: 'warning',
          card_id: card.id,
          message: `${card.id} has invalid trust_label "${String(trustLabel)}". Valid values: ${validTrustLabelsMessage()}.`,
        });
      } else if (trustLabel.trim() === 'untrusted_content') {
        issues.push({
          type: 'untrusted_content',
          severity: 'warning',
          card_id: card.id,
          message: `${card.id} is marked as untrusted content. Review for accuracy.`,
        });
      }
      if (!sensitivity || (typeof sensitivity === 'string' && sensitivity.trim() === '')) {
        issues.push({
          type: 'unclassified_sensitivity',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} has no sensitivity label. Consider: public, internal, personal, confidential, secret.`,
        });
      } else if (typeof sensitivity === 'string' && sensitivity.trim() === 'secret') {
        issues.push({
          type: 'secret_memory',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} is marked as secret and will not appear in agent context.`,
        });
      }
    }
  } finally { /* Don't close DB */ }
  return issues;
}

/**
 * v1.1.0: Memory poisoning defense — detect patterns that may indicate
 * adversarial or corrupted memory injection.
 */
export function checkMemoryPoisoning(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];
  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }
  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    const totalCards = cards.filter(c => c.type !== 'trace').length;
    if (totalCards === 0) return [];
    let untrustedCount = 0;
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const trustLabel = parsed.data.trust_label;
      const classification = parsed.data.classification;
      if (typeof trustLabel === 'string' && trustLabel.trim() === 'untrusted_content') {
        untrustedCount++;
        if (typeof classification === 'string' && classification.trim() === 'fact') {
          issues.push({
            type: 'untrusted_fact',
            severity: 'warning',
            card_id: card.id,
            message: `${card.id} is marked as 'fact' but also 'untrusted_content' — conflicting.`,
          });
        }
      }
      if (
        typeof trustLabel === 'string' && trustLabel.trim() === 'agent_generated' &&
        typeof classification === 'string' && classification.trim() === 'decision' &&
        !parsed.data.user_confirmed
      ) {
        issues.push({
          type: 'agent_only_decision',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} is an agent-generated decision without user_confirmed. Decisions should ideally be user-confirmed.`,
        });
      }
    }
    if (untrustedCount > 0) {
      const ratio = untrustedCount / totalCards;
      if (ratio > 0.2) {
        const pct = Math.round(ratio * 100);
        issues.push({
          type: 'memory_poisoning_risk',
          severity: 'warning',
          message: `${pct}% of cards are untrusted — potential memory poisoning (${untrustedCount}/${totalCards}).`,
          evidence_count: untrustedCount,
        });
      }
    }
  } finally { /* Don't close DB */ }
  return issues;
}

/**
 * Check module-type cards for boundary contract completeness.
 * v1.0.2: each module card should define a contract with owner, interface, and invariants.
 */
export function checkModuleContracts(pmemPath: string): ConsistencyIssue[] {
  const cwd = process.cwd();
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];
  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }
  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare("SELECT * FROM cards WHERE type = 'module' AND is_deleted = 0").all() as CardRow[];
    for (const card of cards) {
      const absPath = path.join(cwd, card.file_path);
      const content = readFile(absPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const contract = parsed.data.contract as Record<string, unknown> | undefined;
      if (!contract || typeof contract !== 'object') {
        issues.push({
          type: 'missing_contract_field',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} is a module but has no boundary contract defined. Consider adding a contract with owner, interface, and invariants.`,
        });
        continue;
      }
      if (!contract.owner || (typeof contract.owner === 'string' && contract.owner.trim() === '')) {
        issues.push({
          type: 'missing_contract_field',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} module contract is missing 'owner'.`,
        });
      }
      if (!contract.interface || (typeof contract.interface === 'string' && contract.interface.trim() === '')) {
        issues.push({
          type: 'missing_contract_field',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} module contract is missing 'interface'.`,
        });
      }
      const invariants = contract.invariants;
      if (!invariants || !Array.isArray(invariants) || invariants.length === 0) {
        issues.push({
          type: 'missing_contract_field',
          severity: 'info',
          card_id: card.id,
          message: `${card.id} module contract is missing 'invariants'. Consider defining invariants.`,
        });
      }
    }
  } finally { /* Don't close DB */ }
  return issues;
}

/**
 * Check for doc-pmem sync drift: cards whose source_files reference
 * files that no longer exist on disk, or cards with no source_files at all.
 */
export function checkDocSync(pmemPath: string): ConsistencyIssue[] {
  const projectRoot = path.join(pmemPath, '..');
  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) return [];
  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(pmemPath); } catch { return []; }
  const issues: ConsistencyIssue[] = [];
  try {
    const cards = db.prepare('SELECT * FROM cards WHERE is_deleted = 0').all() as CardRow[];
    for (const card of cards) {
      if (card.type === 'trace') continue;
      const cardAbsPath = path.join(projectRoot, card.file_path);
      const content = readFile(cardAbsPath);
      if (!content) continue;
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const sourceFiles = parsed.data.source_files;
      if (Array.isArray(sourceFiles) && sourceFiles.length > 0) {
        for (const sourceFile of sourceFiles) {
          if (typeof sourceFile !== 'string') continue;
          const absPath = path.join(projectRoot, sourceFile);
          if (!fileExists(absPath)) {
            issues.push({
              type: 'missing_source_file',
              severity: 'warning',
              card_id: card.id,
              file_path: sourceFile,
              message: `${card.id} references ${sourceFile} which no longer exists.`,
            });
          }
        }
      } else {
        const hasLastVerified = !!(card.last_verified_at || parsed.data.last_verified);
        if (!hasLastVerified) {
          issues.push({
            type: 'untracked_card',
            severity: 'info',
            card_id: card.id,
            message: `${card.id} has no source_files to track sync status.`,
          });
        }
      }
    }
  } finally { /* Don't close DB */ }
  return issues;
}

/** Aggregate all memory consistency checks into a single call. */
export function verifyMemory(pmemPath: string): ConsistencyIssue[] {
  return [
    ...checkStaleMemory(pmemPath),
    ...checkLowConfidence(pmemPath),
    ...checkUnclassifiedCard(pmemPath),
    ...checkSupersededReference(pmemPath),
    ...checkStaleNextStep(pmemPath),
    ...checkConflictingClassifications(pmemPath),
    ...checkTrustLabels(pmemPath),
    ...checkMemoryPoisoning(pmemPath),
    ...checkModuleContracts(pmemPath),
    ...checkDocSync(pmemPath),
  ];
}
