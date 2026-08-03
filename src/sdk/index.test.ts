import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILTIN_SCHEMAS,
  EVENT_SCHEMA,
  MEMORY_SCHEMA,
  SchemaRegistry,
  createSemanticEvidence,
  evaluateGoldenFixture,
  runGoldenQuality,
  evaluateQuality,
  packContext,
  v12OpenOptionsToCanonical,
} from './index';

describe('SDK v1.3 public boundary', () => {
  it('exposes built-in schemas and the registry through the same public entrypoint', () => {
    const registry = new SchemaRegistry();
    assert.equal(registry.get({ id: 'memory', version: '1.0.0' }).ref.id, MEMORY_SCHEMA.ref.id);
    assert.equal(registry.get({ id: 'event', version: '1.0.0' }).ref.id, EVENT_SCHEMA.ref.id);
    assert.equal(BUILTIN_SCHEMAS.length, 2);
  });

  it('keeps v1.2 open options on the canonical Runtime open contract', () => {
    const options = v12OpenOptionsToCanonical({ root: '/tmp/sdk-project' });
    assert.equal(options.root, '/tmp/sdk-project');
    assert.equal(options.compatibility.source, '1.2');
  });

  it('exposes quality, evidence, and ContextPack contracts through the SDK', () => {
    const report = evaluateQuality([{ queryId: 'q1', relevantIds: ['memory.a'], retrievedIds: ['memory.a'] }]);
    assert.equal(report.aggregate.meanRecallAtK, 1);
    const evidence = createSemanticEvidence({
      provenance: { model: 'test', revision: 'r1', dimension: 384, chunkStrategy: 'heading-aware-v1' },
      chunkId: 'memory.a#0',
      similarity: 0.9,
      parentRecord: 'memory.a',
    });
    assert.equal(evidence.authority, 'supporting');
    const pack = packContext({ query: 'q1', records: [{ id: 'memory.a', content: 'answer' }] });
    assert.equal(pack.schemaVersion, '1');
    assert.equal(pack.records[0]?.id, 'memory.a');
    const golden = evaluateGoldenFixture({
      version: 1,
      name: 'sdk',
      k: 1,
      queries: [{ queryId: 'q1', query: 'q1', relevantIds: ['memory.a'] }],
    }, [{ queryId: 'q1', retrievedIds: ['memory.a'] }], {
      thresholds: { minCoverage: 1, minMeanRecallAtK: 1 },
    });
    assert.equal(golden.gate.passed, true);
    const goldenRun = runGoldenQuality(golden.fixture, [{ queryId: 'q1', retrievedIds: ['memory.a'] }]);
    assert.equal(goldenRun.exitCode, 0);
  });
});
