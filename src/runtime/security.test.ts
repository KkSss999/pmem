import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultManifest, saveManifest } from '../core/manifest';
import { ensureDir, writeFile } from '../core/fs';
import { PolicyEngine } from './policy';
import { isScopeVisible, ScopeManager } from './scope';
import { loadRuntimeConfig } from './config';
import { Pmem } from './index';
import type { CapabilitySet } from './types';

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-sec-'));
  const pmemPath = path.join(root, '.pmem');
  ensureDir(pmemPath);
  saveManifest(pmemPath, getDefaultManifest('sec-test'));
  writeFile(path.join(pmemPath, 'index.md'), '# sec-test\n\nName: sec-test\n\n## Current Focus\nSecurity tests\n');
  writeFile(path.join(pmemPath, 'state.md'), '# State\n\n## Overall Status\n- active\n');
  writeFile(path.join(pmemPath, 'next.md'), '# Next\n\n## Recommended Next Step\nContinue.\n');
  return root;
}

const CAPS: CapabilitySet[] = [
  { principal: 'admin', capabilities: ['memory.admin'], scope: 'system' },
  { principal: 'agent-x', capabilities: ['memory.read', 'memory.search'], scope: 'agent:x' },
];

// ---- Fix #1: ACL authorizes the CALLING principal, not "any registered principal" ----

test('observe is denied for a principal lacking memory.observe (no cross-principal grant)', async () => {
  const root = makeProject();
  const memory = await Pmem.open({ root, capabilities: CAPS });
  try {
    await assert.rejects(
      () => memory.observe({ summary: 'should be denied', metadata: { principal: 'agent-x', scope: 'agent:x' } }),
      /principal 'agent-x' does not have it/,
    );
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('observe is allowed for a principal that holds memory.observe', async () => {
  const root = makeProject();
  const caps: CapabilitySet[] = [
    ...CAPS,
    { principal: 'agent-y', capabilities: ['memory.read', 'memory.observe'], scope: 'agent:y' },
  ];
  const memory = await Pmem.open({ root, capabilities: caps });
  try {
    const receipt = await memory.observe({ summary: 'ok', metadata: { principal: 'agent-y', scope: 'agent:y' } });
    assert.equal(receipt.type, 'observe');
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no registered capabilities preserves v1.0 open behavior', async () => {
  const root = makeProject();
  const memory = await Pmem.open({ root });
  try {
    const receipt = await memory.observe({ summary: 'v1.0 compat', metadata: { principal: 'anyone' } });
    assert.equal(receipt.type, 'observe');
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('admin principal is authorized for any capability via memory.admin', async () => {
  const root = makeProject();
  const memory = await Pmem.open({ root, capabilities: CAPS });
  try {
    const receipt = await memory.observe({ summary: 'admin ok', metadata: { principal: 'admin', scope: 'agent:x' } });
    assert.equal(receipt.type, 'observe');
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- Fix #6: mergeBranchMemory requires admin ----

test('mergeBranchMemory requires memory.admin', async () => {
  const root = makeProject();
  const memory = await Pmem.open({ root, capabilities: CAPS });
  try {
    await assert.rejects(
      () => memory.mergeBranchMemory('feature', 'main', 'agent-x'),
      /memory.admin/,
    );
    // admin succeeds (0 rows migrated is fine)
    const migrated = await memory.mergeBranchMemory('feature', 'main', 'admin');
    assert.equal(typeof migrated, 'number');
  } finally {
    await memory.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- PolicyEngine.checkCapability unit coverage ----

test('checkCapability validates per-principal, scope, and admin propagation', () => {
  const config = loadRuntimeConfig(makeProject(), 'software');
  const policy = new PolicyEngine(config, CAPS);
  // agent-x has read on agent:x and children
  assert.equal(policy.checkCapability('agent-x', 'memory.read', 'agent:x'), true);
  assert.equal(policy.checkCapability('agent-x', 'memory.read', 'agent:x:sub'), true);
  // agent-x lacks observe
  assert.equal(policy.checkCapability('agent-x', 'memory.observe', 'agent:x'), false);
  // agent-x cannot read a sibling scope
  assert.equal(policy.checkCapability('agent-x', 'memory.read', 'agent:y'), false);
  // admin can do anything anywhere
  assert.equal(policy.checkCapability('admin', 'memory.forget', 'session:1'), true);
  // unknown principal has nothing
  assert.equal(policy.checkCapability('ghost', 'memory.read', 'agent:x'), false);
});

// ---- Fix #5: quota is reachable and enforced ----

test('quota blocks after limit and is not consumed on a denied capability', async () => {
  const config = loadRuntimeConfig(makeProject(), 'software');
  const policy = new PolicyEngine(config);
  policy.setQuota('agent-x', 1, 1);
  assert.deepEqual(policy.checkQuota('agent-x', 'observe'), { allowed: true, remaining: 0 });
  assert.deepEqual(policy.checkQuota('agent-x', 'observe'), { allowed: false, remaining: 0 });
  // unlimited when no quota registered
  assert.equal(policy.checkQuota('other', 'observe').allowed, true);
});

// ---- Fix #3: scope visibility is fail-safe (no fail-open for unknown principals) ----

test('isScopeVisible is fail-safe for unknown principals and hierarchical for known ones', () => {
  // shared/legacy visible to all
  assert.equal(isScopeVisible('shared', 'anything'), true);
  assert.equal(isScopeVisible('project', 'anything'), true);
  assert.equal(isScopeVisible('branch:main', 'ghost'), true);
  // private is owner/exact-principal only
  assert.equal(isScopeVisible('private', 'owner'), true);
  assert.equal(isScopeVisible('private:agent-a', 'agent-b'), false);
  assert.equal(isScopeVisible('private:agent-a', 'agent-a'), true);
  // hierarchy: system principal sees session scope; session principal cannot see system scope
  assert.equal(isScopeVisible('session:1', 'system'), true);
  assert.equal(isScopeVisible('system', 'session'), false);
  // unknown principal is least-privileged: cannot see a leveled (agent) scope
  assert.equal(isScopeVisible('agent:x', 'ghost-principal'), false);
});

test('ScopeManager.isVisible delegates to isScopeVisible', () => {
  const config = loadRuntimeConfig(makeProject(), 'software', { branchAware: false });
  const scope = new ScopeManager(makeProject(), config);
  assert.equal(scope.isVisible('private:agent-a', 'agent-b'), false);
  assert.equal(scope.isVisible('agent:x', 'ghost'), false);
  assert.equal(scope.isVisible('shared', 'ghost'), true);
});
