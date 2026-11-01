'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const access = {
  readableSpaceIds: ['personal'],
  writableSpaceIds: ['personal'],
  canManageSpaces: false,
};

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-pipeline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '..', 'dist'), path.join(root, 'dist'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'migrations'), path.join(root, 'migrations'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.join(__dirname, '..', 'node_modules'),
    path.join(root, 'node_modules'),
    'dir'
  );
  const { OwnedDatabase } = require(path.join(root, 'dist/db/database'));
  const { assembleMemory } = require(path.join(root, 'dist/server/memory'));
  const l1Module = require(path.join(root, 'dist/server/l1'));
  const maintenanceModule = require(path.join(root, 'dist/server/l1-maintenance'));
  const l2Module = require(path.join(root, 'dist/server/l2'));
  const l3Module = require(path.join(root, 'dist/server/l3'));
  const db = OwnedDatabase.create(path.join(root, 'memory.sqlite'));
  t.after(() => db.close());
  return {
    memory: assembleMemory(db),
    l1: l1Module.assembleL1(db),
    maintenance: maintenanceModule.assembleL1Maintenance(db),
    l2: l2Module.assembleL2(db, options.l2),
    l3: l3Module.assembleL3(db),
  };
}

function extractMemory(f, content) {
  const appended = f.memory.appendL0(
    { spaceId: 'personal', role: 'user', content, occurredAt: '2026-11-01T00:00:00.000Z' },
    access
  );
  const preparation = f.l1.prepareStream(appended.message.id, access);
  const [memory] = f.l1.applyStream(
    preparation,
    {
      memories: [
        {
          content,
          abstraction: content,
          cues: ['test'],
          sourceIds: [appended.message.id],
          relatedSpaceIds: [],
        },
      ],
    },
    access
  );
  return memory;
}

function completeMaintenance(f, memoryId) {
  const preparation = f.maintenance.prepareStream(memoryId, access);
  const decisions = preparation.cases
    .filter((item) => item.candidates.length)
    .map((item) => ({
      memoryId: item.memory.id,
      action: 'keep',
      targetId: null,
      content: null,
      abstraction: null,
      cues: [],
    }));
  return f.maintenance.applyStream(preparation, { decisions }, access);
}

function synthesize(f, l1Id, title) {
  return f.l2.prepareStream(l1Id, access).then((preparation) =>
    f.l2.applyStream(
      preparation,
      {
        results: [
          {
            action: 'create',
            title,
            summary: `${title} summary`,
            body: `${title} body`,
            l1Ids: [l1Id],
          },
        ],
        uncoveredL1Ids: [],
      },
      access
    )
  );
}

function generateKeywords(f, l2Id, term) {
  const hash = f.l3.streamSourceHash(l2Id);
  assert.ok(hash, 'an L2 memory must expose a stream hash');
  const preparation = f.l3.prepareStream(l2Id, hash, access);
  return f.l3.applyStream(
    preparation,
    { keywords: [{ term, aliases: [], kind: 'topic', baseWeight: 3, l2Ids: [l2Id] }] },
    access
  );
}

test('L1 to L2 to L3 stream commits run end to end', async (t) => {
  const f = fixture(t);
  const memory = extractMemory(f, 'I prefer bun over npm for TypeScript projects.');
  assert.equal(f.l1.getMemory(memory.id, access).maintenanceStatus, 'pending');

  assert.equal(completeMaintenance(f, memory.id), memory.id);
  assert.equal(f.l1.getMemory(memory.id, access).maintenanceStatus, 'complete');

  const synthesized = await synthesize(f, memory.id, 'TypeScript package manager');
  assert.equal(synthesized.committed, 1);
  const [l2Id] = synthesized.l2Ids;
  const l2 = f.l2.getMemory(l2Id, access);
  assert.equal(l2.title, 'TypeScript package manager');
  assert.deepEqual(l2.l1Ids, [memory.id]);
  assert.equal(l2.visible, true);

  const keywordIds = generateKeywords(f, l2Id, 'package manager');
  assert.equal(keywordIds.length, 1);
  assert.equal(f.l3.getKeyword(keywordIds[0], access).term, 'package manager');

  const resolved = f.l3.resolve('package manager', ['personal'], access);
  assert.equal(resolved.keywords.length, 1);
  assert.deepEqual(
    resolved.l2.map((item) => item.id),
    [l2Id]
  );
});

test('an L2 update replaces the current state of a candidate', async (t) => {
  const f = fixture(t);
  const first = extractMemory(f, 'My deploy target is Fly.io.');
  completeMaintenance(f, first.id);
  const created = await synthesize(f, first.id, 'Deploy target');
  const [l2Id] = created.l2Ids;

  const second = extractMemory(f, 'My deploy target moved from Fly.io to Railway.');
  completeMaintenance(f, second.id);
  const prepared = await f.l2.prepareStream(second.id, access);
  assert.equal(prepared.candidates.length, 1);
  const result = f.l2.applyStream(
    prepared,
    {
      results: [
        {
          action: 'update',
          l2Id,
          supersede: true,
          title: 'Deploy target',
          summary: 'Deployments run on Railway',
          body: 'Deployments moved from Fly.io to Railway.',
          l1Ids: [second.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    access
  );
  assert.equal(result.committed, 1);
  assert.deepEqual(result.l2Ids, [l2Id]);
  const updated = f.l2.getMemory(l2Id, access);
  assert.equal(updated.body, 'Deployments moved from Fly.io to Railway.');
  assert.deepEqual(updated.l1Ids, [second.id]);
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, access).length, 1);
});

test('a replacement judgment supersedes the candidate L2', async (t) => {
  const judge = {
    async judge(input) {
      return input.changes.map((change) => ({ changedL1Id: change.id, type: 'replacement' }));
    },
  };
  const f = fixture(t, { l2: { judge } });
  const first = extractMemory(f, 'My editor is Neovim.');
  completeMaintenance(f, first.id);
  const before = await synthesize(f, first.id, 'Editor');
  const [candidateId] = before.l2Ids;

  const second = extractMemory(f, 'I switched my editor from Neovim to Zed.');
  completeMaintenance(f, second.id);
  // The judged candidate is withheld from generation and replaced by the new memory.
  const prepared = await f.l2.prepareStream(second.id, access);
  assert.equal(prepared.candidatesForModel.length, 0);
  const result = f.l2.applyStream(
    prepared,
    {
      results: [
        {
          action: 'create',
          supersede: true,
          title: 'Editor',
          summary: 'The editor is Zed',
          body: 'The editor changed from Neovim to Zed.',
          l1Ids: [second.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    access
  );
  assert.equal(result.committed, 1);
  const replacementId = result.l2Ids[0];
  assert.notEqual(replacementId, candidateId);
  assert.equal(f.l2.getMemory(candidateId, access).visible, false);
  assert.equal(f.l2.getMemory(candidateId, access).supersededBy, replacementId);
});
