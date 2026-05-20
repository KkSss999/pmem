import * as path from 'path';
import * as crypto from 'crypto';
import { readFile, fileExists, listFiles } from '../core/fs';
import { loadManifest } from '../core/manifest';
import type { VerifyIssue, VerifyResult, GraphIndex } from '../types';
import { rebuildCommand } from './rebuild';

const PMEM_DIR = '.pmem';

export function verifyCommand(options: { fix?: boolean }): void {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, PMEM_DIR);

  if (!fileExists(pmemPath)) {
    console.log('No .pmem directory found. Run `pmem init` first.');
    return;
  }

  const issues: VerifyIssue[] = [];

  // 1. Check manifest exists
  const manifest = loadManifest(pmemPath);
  if (!manifest) {
    issues.push({
      severity: 'error',
      type: 'missing_manifest',
      message: '.pmem/manifest.yml not found or invalid.',
      fix: 'Run: pmem init',
    });
  }

  // 2. Check index/graph.json exists and is consistent with source cards
  if (manifest) {
    const graphPath = path.join(pmemPath, 'indexes', 'graph.json');
    if (!fileExists(graphPath)) {
      issues.push({
        severity: 'warning',
        type: 'missing_index',
        message: 'indexes/graph.json not found.',
        fix: 'Run: pmem rebuild',
      });
    } else {
      const graphContent = readFile(graphPath);
      if (graphContent) {
        try {
          const graph: GraphIndex = JSON.parse(graphContent);

          // Check if source hash matches
          const cardFiles = listFiles(pmemPath, /\.md$/).filter(f => {
            const rel = path.relative(pmemPath, f);
            return !['index.md', 'state.md', 'next.md'].includes(rel) &&
                   !rel.startsWith('skills/') &&
                   !rel.startsWith('integrations/') &&
                   !rel.startsWith('summaries/') &&
                   !rel.startsWith('indexes/');
          });

          const allContent = cardFiles.map(f => readFile(f) || '').join('');
          const currentHash = crypto.createHash('sha256').update(allContent).digest('hex').substring(0, 16);

          if (currentHash !== graph.source.source_hash) {
            issues.push({
              severity: 'warning',
              type: 'stale_index',
              message: 'indexes/graph.json is stale. Source cards changed after the graph index was generated.',
              fix: 'Run: pmem rebuild',
            });
          }

          // Check for orphan nodes (referenced in edges but not in nodes)
          const nodeIds = new Set(graph.nodes.map(n => n.id));
          const orphanEdges = graph.edges.filter(e => !nodeIds.has(e.from) || !nodeIds.has(e.to));
          if (orphanEdges.length > 0) {
            issues.push({
              severity: 'warning',
              type: 'orphan_edges',
              message: `${orphanEdges.length} edge(s) reference non-existent nodes.`,
              fix: 'Run: pmem rebuild',
            });
          }

          // 7. Validate cards against card_policy
          if (manifest.card_policy) {
            const policy = manifest.card_policy;

            // Check ID naming convention
            const idRegex = new RegExp(policy.id_pattern);
            for (const node of graph.nodes) {
              if (!idRegex.test(node.id)) {
                issues.push({
                  severity: 'warning',
                  type: 'card_id_violation',
                  message: `Card "${node.id}" does not match naming pattern.`,
                  fix: `Rename card ID to match: ${policy.id_pattern}`,
                });
              }
            }

            // Check for oversized cards (token count estimate: ~1 token per 4 chars)
            for (const node of graph.nodes) {
              const cardPath = path.join(pmemPath, '..', node.file);
              const content = readFile(cardPath);
              if (content) {
                const estimatedTokens = Math.ceil(content.length / 4);
                const maxForType = policy.max_tokens[node.type];
                if (maxForType && estimatedTokens > maxForType) {
                  issues.push({
                    severity: 'warning',
                    type: 'card_too_large',
                    message: `Card "${node.id}" is ~${estimatedTokens} tokens (max for ${node.type}: ${maxForType}).`,
                    fix: 'Consider splitting this card or run `pmem distill --suggest-splits`.',
                  });
                }
              }
            }

            // Check related count threshold
            for (const node of graph.nodes) {
              const relatedEdgeCount = graph.edges.filter(
                e => e.from === node.id || e.to === node.id
              ).length;
              if (relatedEdgeCount > policy.warn_when_related_count_gt) {
                issues.push({
                  severity: 'warning',
                  type: 'too_many_relations',
                  message: `Card "${node.id}" has ${relatedEdgeCount} relations (threshold: ${policy.warn_when_related_count_gt}).`,
                  fix: 'Review whether all relations are necessary.',
                });
              }
            }
          }
        } catch {
          issues.push({
            severity: 'error',
            type: 'invalid_index',
            message: 'indexes/graph.json is malformed.',
            fix: 'Run: pmem rebuild',
          });
        }
      }
    }

    // 3. Check AGENTS.md exists
    if (!fileExists(path.join(cwd, 'AGENTS.md'))) {
      issues.push({
        severity: 'warning',
        type: 'missing_agents',
        message: 'AGENTS.md not found in project root.',
        fix: 'Run: pmem init',
      });
    }

    // 4. Check pmem version compatibility
    const expectedVersion = '0.2';
    if (manifest.pmem?.protocol_version !== expectedVersion) {
      issues.push({
        severity: 'warning',
        type: 'version_mismatch',
        message: `pmem version mismatch: manifest says ${manifest.pmem?.protocol_version || 'unknown'}, CLI is ${expectedVersion}.`,
        fix: 'Update manifest or run migration.',
      });
    }

    // 5. Check memory_status.dirty
    if (manifest.memory_status?.dirty) {
      issues.push({
        severity: 'warning',
        type: 'memory_dirty',
        message: `Memory is marked dirty since ${manifest.memory_status.dirty_since || 'unknown'}. Reason: ${manifest.memory_status.dirty_reason || 'unknown'}.`,
        fix: 'Run: pmem update --auto (to detect changes) or pmem update --confirm (to record updates).',
      });
    }

    // 6. Check schema_version compatibility
    const currentSchema = manifest.pmem?.schema_version;
    if (!currentSchema) {
      issues.push({
        severity: 'warning',
        type: 'missing_schema_version',
        message: 'Manifest is missing pmem.schema_version. This project may have been created with pmem v0.1.',
        fix: 'Run: pmem migrate --to 0.2',
      });
    } else if (currentSchema < '0.2') {
      issues.push({
        severity: 'warning',
        type: 'old_schema_version',
        message: `Project schema version is ${currentSchema}. Current CLI supports 0.2.`,
        fix: 'Run: pmem migrate --to 0.2 --dry-run (then without --dry-run to apply)',
      });
    } else if (currentSchema > '0.2') {
      issues.push({
        severity: 'error',
        type: 'newer_schema_version',
        message: `Project schema version is ${currentSchema}. Current CLI only supports up to 0.2.`,
        fix: 'Please upgrade pmem CLI to a newer version.',
      });
    }
  }

  // Build result
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const passed = errors.length === 0;
  const score = Math.max(0, 100 - errors.length * 30 - warnings.length * 5);

  const result: VerifyResult = { passed, score, issues };

  // Output
  if (passed && warnings.length === 0) {
    console.log(`✓ Memory verification passed.`);
    console.log(`  Score: ${score}/100`);
    return;
  }

  console.log(`Memory Verify Result: ${passed ? 'Warnings found' : 'Failed'}`);
  console.log(`Score: ${score}/100`);
  console.log('');

  for (const issue of issues) {
    const icon = issue.severity === 'error' ? '✗' : '⚠';
    console.log(`${icon} [${issue.type}] ${issue.message}`);
    console.log(`  Fix: ${issue.fix}`);
    console.log('');
  }

  // Auto-fix if requested
  if (options.fix) {
    const staleIssue = issues.find(i => i.type === 'stale_index' || i.type === 'missing_index' || i.type === 'invalid_index');
    if (staleIssue) {
      console.log('Auto-fixing: rebuilding indexes...');
      rebuildCommand();
    }
  }
}
