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
    root,
    db,
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
  const preparation = f.l3.prepareStream([{ l2Id, l2Hash: hash }], access);
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

  assert.deepEqual(completeMaintenance(f, memory.id), [memory.id]);
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

test('maintenance with nothing to compare is kept locally, without a model call', async (t) => {
  const f = fixture(t);
  const memory = extractMemory(f, 'My car is a Honda Civic.');
  const { L1MaintenanceStreamHandler } = require(
    path.join(f.root, 'dist/agent/l1-maintenance-stream-handler')
  );
  const committed = [];
  const handler = new L1MaintenanceStreamHandler(f.maintenance, access, (id) => committed.push(id));
  const prepared = handler.prepare([
    {
      id: 'maintenance-item',
      workspaceId: 'pmem-eval',
      scopeId: 'personal',
      kind: 'l1-maintenance',
      subjectId: memory.id,
      sourceHash: 'v1',
      state: 'running',
      attempt: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ]);
  assert.equal(prepared, null);
  assert.deepEqual(committed, [[memory.id]]);
  assert.equal(f.l1.getMemory(memory.id, access).maintenanceStatus, 'complete');
});

test('a keep decision ignores extra fields instead of failing', (t) => {
  const f = fixture(t);
  const first = extractMemory(f, 'I prefer tea in the morning.');
  completeMaintenance(f, first.id);
  const second = extractMemory(f, 'I prefer tea before noon.');
  const preparation = f.maintenance.prepareStream(second.id, access);
  assert.ok(preparation.modelCases.length > 0, 'a similar memory must be a candidate');
  f.maintenance.applyStream(
    preparation,
    {
      decisions: [
        {
          memoryId: second.id,
          action: 'keep',
          targetId: null,
          content: null,
          abstraction: null,
          cues: ['tea', 'morning'],
        },
      ],
    },
    access
  );
  assert.equal(f.l1.getMemory(second.id, access).maintenanceStatus, 'complete');
});

test('L2 treats a batch of L1 memories as one preparation', async (t) => {
  const f = fixture(t);
  const first = extractMemory(f, 'The API listens on port 8080.');
  const second = extractMemory(f, 'The API uses PostgreSQL 16.');
  completeMaintenance(f, first.id);
  completeMaintenance(f, second.id);
  const preparation = await f.l2.prepareStream([first.id, second.id], access);
  assert.equal(preparation.loaded.length, 2);
  assert.deepEqual([...preparation.l1Ids].sort(), [first.id, second.id].sort());
  const result = f.l2.applyStream(
    preparation,
    {
      results: [
        {
          action: 'create',
          title: 'API port',
          summary: 'Listens on 8080',
          body: 'The API listens on port 8080.',
          l1Ids: [first.id],
        },
        {
          action: 'create',
          title: 'API database',
          summary: 'Uses PostgreSQL 16',
          body: 'The API uses PostgreSQL 16.',
          l1Ids: [second.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    access
  );
  assert.equal(result.committed, 2);
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, access).length, 2);
});

test('L3 generates keywords for a batch of L2 memories in one call', async (t) => {
  const f = fixture(t);
  const created = [];
  for (const [index, content] of [
    'The API listens on port 8080.',
    'The API uses PostgreSQL 16.',
  ].entries()) {
    const memory = extractMemory(f, content);
    completeMaintenance(f, memory.id);
    const prepared = await f.l2.prepareStream(memory.id, access);
    const result = f.l2.applyStream(
      prepared,
      {
        results: [
          {
            action: 'create',
            title: `topic ${index}`,
            summary: content,
            body: content,
            l1Ids: [memory.id],
          },
        ],
        uncoveredL1Ids: [],
      },
      access
    );
    created.push(result.l2Ids[0]);
  }
  const preparation = f.l3.prepareStream(
    created.map((l2Id) => ({ l2Id, l2Hash: f.l3.streamSourceHash(l2Id) })),
    access
  );
  assert.equal(preparation.entries.length, 2);
  const keywords = f.l3.applyStream(
    preparation,
    {
      keywords: created.map((l2Id, index) => ({
        term: `batch keyword ${index}`,
        aliases: [],
        kind: 'topic',
        baseWeight: 3,
        l2Ids: [l2Id],
      })),
    },
    access
  );
  assert.equal(keywords.length, 2);
});

test('an L2 change the model does not cover is left as an L1-only fact', async (t) => {
  const f = fixture(t);
  const first = extractMemory(f, 'The API listens on port 8080.');
  const second = extractMemory(f, 'The API uses PostgreSQL 16.');
  completeMaintenance(f, first.id);
  completeMaintenance(f, second.id);
  const preparation = await f.l2.prepareStream([first.id, second.id], access);
  const result = f.l2.applyStream(
    preparation,
    {
      results: [
        {
          action: 'create',
          title: 'API port',
          summary: 'Listens on 8080',
          body: 'The API listens on port 8080.',
          l1Ids: [first.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    access
  );
  assert.equal(result.committed, 1);
  assert.equal(f.l2.listMemories({ ownerSpaceId: 'personal' }, access).length, 1);
  // The uncovered change keeps its own L1 memory readable as evidence.
  assert.ok(f.l1.getMemory(second.id, access));
});

test('a merge completes the target maintenance so its L2 can run', async (t) => {
  const f = fixture(t);
  const target = extractMemory(f, 'I live in Hangzhou.');
  completeMaintenance(f, target.id);
  const source = extractMemory(f, 'I live in Hangzhou, near the lake.');
  const preparation = f.maintenance.prepareStream(source.id, access);
  const candidate = preparation.modelCases[0]?.candidates.find((entry) => entry.id === target.id);
  assert.ok(candidate, 'the earlier memory must be a merge candidate');
  f.maintenance.applyStream(
    preparation,
    {
      decisions: [
        {
          memoryId: source.id,
          action: 'merge',
          targetId: target.id,
          content: 'I live in Hangzhou, near the lake.',
          abstraction: 'Home city',
          cues: ['Hangzhou'],
        },
      ],
    },
    access
  );
  const merged = f.l1.getMemory(target.id, access);
  assert.equal(merged.maintenanceStatus, 'complete');
  assert.equal(merged.content, 'I live in Hangzhou, near the lake.');
  // The merged memory is immediately usable for L2 synthesis.
  const l2 = await f.l2.prepareStream(target.id, access);
  assert.equal(l2.loaded.length, 1);
});

test('L2 skips a change whose L1 maintenance is still pending', async (t) => {
  const f = fixture(t);
  const ready = extractMemory(f, 'The API listens on port 8080.');
  completeMaintenance(f, ready.id);
  const pending = extractMemory(f, 'The API uses PostgreSQL 16.');
  const preparation = await f.l2.prepareStream([ready.id, pending.id], access);
  assert.deepEqual(
    preparation.loaded.map((entry) => entry.l1Id),
    [ready.id]
  );
  assert.deepEqual(preparation.deferredL1Ids, [pending.id]);
  const result = f.l2.applyStream(
    preparation,
    {
      results: [
        {
          action: 'create',
          title: 'API port',
          summary: 'Listens on 8080',
          body: 'The API listens on port 8080.',
          l1Ids: [ready.id],
        },
      ],
      uncoveredL1Ids: [],
    },
    access
  );
  assert.equal(result.committed, 1);
});
