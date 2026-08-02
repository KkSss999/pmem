import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CompatibilityError,
  recordToV12Card,
  v12CardToRecord,
  v12ManifestToLegacySchema,
  v12ManifestToSchema,
  v12OpenOptionsToCanonical,
} from './v1_2';
import type { MemoryCard } from '../types';

describe('v1.2 compatibility boundary', () => {
  it('maps legacy root and pmemPath options without changing project-root semantics', () => {
    const fromRoot = v12OpenOptionsToCanonical({ root: '/tmp/project', preset: 'software' });
    assert.equal(fromRoot.root, '/tmp/project');
    assert.equal(fromRoot.preset, 'software');

    const fromPmemPath = v12OpenOptionsToCanonical({ pmemPath: '/tmp/project/.pmem' });
    assert.equal(fromPmemPath.root, '/tmp/project');
    assert.equal(fromPmemPath.compatibility.source, '1.2');
  });

  it('fails closed for missing or conflicting legacy roots', () => {
    assert.throws(() => v12OpenOptionsToCanonical({}), (error: unknown) =>
      error instanceof CompatibilityError && error.code === 'INVALID_OPEN_OPTIONS');
    assert.throws(
      () => v12OpenOptionsToCanonical({ root: '/tmp/a', pmemPath: '/tmp/b/.pmem' }),
      (error: unknown) => error instanceof CompatibilityError && error.field === 'pmemPath',
    );
  });

  it('round-trips CardFrontmatter, body, file path, and unknown frontmatter fields', () => {
    const card: MemoryCard = {
      frontmatter: {
        id: 'decision.compat',
        type: 'decision',
        status: 'completed',
        classification: 'decision',
        custom_legacy_field: 'preserved',
      } as MemoryCard['frontmatter'] & { custom_legacy_field: string },
      body: '# Legacy decision\n\nKeep this content.',
      filePath: '/tmp/project/.pmem/decisions/decision.compat.md',
    };
    const record = v12CardToRecord(card);
    assert.equal(record.id, 'decision.compat');
    assert.equal(record.schema.id, 'decision');
    assert.equal(record.data.custom_legacy_field, 'preserved');
    const restored = recordToV12Card(record);
    assert.deepEqual(restored.frontmatter, card.frontmatter);
    assert.equal(restored.body, card.body);
    assert.equal(restored.filePath, card.filePath);
  });

  it('accepts an explicitly empty legacy Markdown body', () => {
    const record = v12CardToRecord({
      frontmatter: { id: 'trace.empty', type: 'trace' },
      body: '',
      filePath: '/tmp/project/.pmem/traces/trace.empty.md',
    });
    assert.equal(record.data.body, '');
    assert.equal(recordToV12Card(record).body, '');
  });

  it('reports unknown and missing card fields as compatibility errors', () => {
    assert.throws(() => v12CardToRecord({ body: 'content', filePath: 'a.md' }), (error: unknown) =>
      error instanceof CompatibilityError && error.field === 'frontmatter');
    assert.throws(() => v12CardToRecord({ frontmatter: { id: 'x' }, body: 'content', filePath: 'a.md' }), (error: unknown) =>
      error instanceof CompatibilityError && error.field === 'frontmatter.type');
    assert.throws(() => recordToV12Card({ id: 'x', schema: { id: 'decision', version: '1' }, data: { id: 'other', type: 'decision', body: 'x' }, provenance: { source: 'markdown', source_id: 'x.md' } }), (error: unknown) =>
      error instanceof CompatibilityError && error.code === 'INVALID_RECORD');
  });

  it('maps a legacy software preset and custom manifest schema', () => {
    const software = v12ManifestToLegacySchema({
      pmem: { schema_version: '0.3', protocol_version: '0.3' },
      project: { name: 'legacy-software', domain: 'software' },
    });
    assert.ok(software.cardTypes.includes('module'));
    assert.equal(software.defaultType, 'trace');
    assert.equal(software.source.domain, 'software');

    const custom = v12ManifestToLegacySchema({
      pmem: { schema_version: '0.3', protocol_version: '0.3' },
      project: { name: 'custom' },
      schema: {
        card_types: ['memory', 'event'],
        type_dirs: { memory: 'memories', event: 'events' },
        foundational_types: ['memory'],
        evidence_types: ['event'],
        default_type: 'memory',
        creatable_types: ['memory'],
      },
    });
    assert.deepEqual(custom.cardTypes, ['memory', 'event']);
    assert.equal(custom.typeDirectories.memory, 'memories');
    assert.deepEqual(custom.creatableTypes, ['memory']);

    const canonical = v12ManifestToSchema({
      pmem: { schema_version: '0.3', protocol_version: '0.3' },
      project: { name: 'custom' },
      schema: { card_types: ['memory', 'event'] },
    });
    assert.equal(canonical.ref.id, 'legacy.custom');
    assert.deepEqual(canonical.metadata?.card_types, ['memory', 'event']);
  });

  it('rejects missing and unsupported manifest versions', () => {
    assert.throws(() => v12ManifestToSchema({ project: { name: 'missing-version' } }), (error: unknown) =>
      error instanceof CompatibilityError && error.field === 'pmem');
    assert.throws(() => v12ManifestToSchema({ pmem: { schema_version: '1.3' }, project: { name: 'future' } }), (error: unknown) =>
      error instanceof CompatibilityError && error.code === 'UNSUPPORTED_VERSION');
    assert.throws(() => v12ManifestToSchema({ pmem: { schema_version: '0.3' } }), (error: unknown) =>
      error instanceof CompatibilityError && error.field === 'project');
  });
});
