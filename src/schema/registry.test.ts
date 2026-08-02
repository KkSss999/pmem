import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemorySchemaRegistry } from '../runtime/model';
import {
  DuplicateSchemaError,
  EVENT_SCHEMA,
  InvalidSchemaError,
  MEMORY_SCHEMA,
  SchemaRegistry,
  SchemaValidationError,
  UnknownSchemaError,
  BuiltinSchemaError,
  type MemorySchema,
  type MemorySchemaDefinition,
} from './index';

test('registry ships only the generic memory and event builtins', () => {
  const registry = new SchemaRegistry();
  const runtimePort: MemorySchemaRegistry = registry;
  assert.ok(runtimePort);
  assert.deepEqual(registry.list().map((schema) => schema.ref.id), ['event', 'memory']);
  assert.equal(registry.get('memory').metadata?.source, 'builtin');
  assert.equal(registry.get('event').metadata?.source, 'builtin');
  assert.equal(registry.find('software'), undefined);
});

test('registry rejects duplicate name and normalized version', () => {
  const registry = new SchemaRegistry({
    name: 'example',
    version: '1',
    fields: { id: { type: 'id', required: true } },
  });
  assert.throws(
    () => registry.register({ name: 'example', version: '1.0.0', fields: { id: { type: 'id' } } }),
    (error: unknown) => error instanceof DuplicateSchemaError,
  );
  assert.equal(registry.get('example').ref.version, '1');
});

test('unknown schemas and versions fail explicitly', () => {
  const registry = new SchemaRegistry();
  assert.throws(() => registry.get('missing'), (error: unknown) => error instanceof UnknownSchemaError);
  assert.throws(() => registry.get({ name: 'memory', version: '9.0.0' }), (error: unknown) => error instanceof UnknownSchemaError);
  assert.equal(registry.has('memory@1.0'), true);
  assert.equal(registry.has('memory@9.0.0'), false);
  assert.equal(registry.resolve({ id: 'missing', version: '1.0.0' }), null);
  assert.equal(registry.resolve({ id: 'memory', version: '1.0.0' })?.ref.id, 'memory');
});

test('custom schema supports required, type, range, array, and strict field checks', () => {
  const registry = new SchemaRegistry();
  const schema: MemorySchemaDefinition = {
    name: 'test.note',
    version: '2.1.0',
    strict: true,
    fields: {
      id: { type: 'id', required: true },
      title: { type: 'string', required: true, minLength: 3 },
      rank: { type: 'integer', min: 1, max: 5 },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };
  registry.register(schema);
  const invalid = registry.validate('test.note', { id: '', title: 'no', rank: 9, tags: ['ok', 2], extra: true });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.issues.map((issue) => issue.code), ['invalid_type', 'invalid_length', 'out_of_range', 'invalid_type', 'unknown_field']);
  assert.equal(registry.validate('test.note@2.1.0', { id: 'n1', title: 'valid', rank: 3, tags: ['one'] }).valid, true);
  assert.throws(() => registry.assertValid('test.note', { id: 'n1' }), (error: unknown) => error instanceof SchemaValidationError);
});

test('builtins validate generic records without domain-specific fields', () => {
  const registry = new SchemaRegistry();
  assert.equal(registry.validate(MEMORY_SCHEMA, { id: 'm1', content: 'hello', custom: { any: true } }).valid, true);
  assert.equal(registry.validate('event', { id: 'e1', type: 'commit', payload: {}, created_at: '2026-08-02T00:00:00.000Z' }).valid, true);
  assert.equal(registry.validate(EVENT_SCHEMA, { id: 'e1', type: 'commit', payload: {} }).valid, false);
});

test('invalid schema definitions fail before registration', () => {
  const registry = new SchemaRegistry();
  assert.throws(() => registry.register({ name: 'bad', version: 'v1', fields: {} }), (error: unknown) => error instanceof InvalidSchemaError);
  assert.throws(() => registry.register({ name: 'bad', version: '1.0.0', fields: { value: {} as never } }), (error: unknown) => error instanceof InvalidSchemaError);
});

test('unregister removes custom schemas but protects builtins', () => {
  const registry = new SchemaRegistry();
  registry.register({ name: 'temporary', version: '1.0.0', fields: { id: { type: 'id' } } });
  assert.equal(registry.has('temporary@1.0.0'), true);
  assert.equal(registry.unregister('temporary@1'), true);
  assert.equal(registry.has('temporary'), false);
  assert.throws(() => registry.unregister('memory@1.0.0'), (error: unknown) => error instanceof BuiltinSchemaError);
});
