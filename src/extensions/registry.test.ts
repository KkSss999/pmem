import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DuplicateExtensionError,
  DuplicateExtensionResourceError,
  ExtensionPermissionError,
  ExtensionRegistry,
  UnknownExtensionError,
  UnknownExtensionResourceError,
  type MemoryExtension,
} from './index';

function extension(id: string, namespace = id): MemoryExtension {
  return {
    id,
    namespace,
    version: '1.0.0',
    schemas: [{ name: 'note', version: '1.0.0', fields: { id: { type: 'id', required: true }, content: { type: 'text', required: true } } }],
    validators: [{ name: 'safe', validate: () => ({ valid: true, schema: 'x', version: '1', issues: [] }) }],
    retrievers: [{ name: 'exact', retrieve: () => [] }],
    projectors: [{ name: 'markdown', project: () => undefined }],
    healthChecks: [{ name: 'ready', check: () => ({ ok: true }) }],
    hooks: [{ name: 'audit', event: 'after_commit', run: () => undefined }],
  };
}

test('registers every supported resource kind and bridges schemas', () => {
  const registry = new ExtensionRegistry();
  registry.register(extension('acme.memory'));
  assert.deepEqual(registry.list().map((item) => item.id), ['acme.memory']);
  assert.deepEqual(registry.listResources('validator'), ['acme.memory.safe']);
  assert.equal(registry.require('retriever', 'acme.memory.exact').name, 'exact');
  assert.equal(registry.require('projector', 'acme.memory.markdown').name, 'markdown');
  assert.equal(registry.require('health', 'acme.memory.ready').name, 'ready');
  assert.equal(registry.require('hook', 'acme.memory.audit').event, 'after_commit');
  assert.equal(registry.schemas.get('acme.memory.note').ref.id, 'acme.memory.note');
  assert.equal(registry.schemas.validate('acme.memory.note', { id: 'n1', content: 'hello' }).valid, true);
});

test('fails closed for duplicate extensions, namespace/resource collisions, and unknown resources', () => {
  const registry = new ExtensionRegistry();
  registry.register(extension('acme.one', 'acme'));
  assert.throws(() => registry.register(extension('acme.one', 'other')), (error: unknown) => error instanceof DuplicateExtensionError);
  assert.throws(() => registry.register(extension('acme.two', 'acme')), (error: unknown) => error instanceof DuplicateExtensionResourceError);
  assert.throws(() => registry.require('retriever', 'missing'), (error: unknown) => error instanceof UnknownExtensionResourceError);
  assert.throws(() => registry.get('missing'), (error: unknown) => error instanceof UnknownExtensionError);
});

test('enforces explicit namespace and capability permissions', () => {
  const registry = new ExtensionRegistry();
  assert.throws(
    () => registry.register(extension('acme.secure', 'acme'), { allowedNamespaces: ['other'] }),
    (error: unknown) => error instanceof ExtensionPermissionError,
  );
  assert.throws(
    () => registry.register(extension('acme.secure', 'secure'), { grantedCapabilities: ['schema.register'] }),
    (error: unknown) => error instanceof ExtensionPermissionError,
  );
});

test('resource resolution and listing are deterministic and namespaced', () => {
  const registry = new ExtensionRegistry();
  registry.register(extension('zeta', 'zeta'));
  registry.register(extension('alpha', 'alpha'));
  assert.deepEqual(registry.list().map((item) => item.id), ['alpha', 'zeta']);
  assert.deepEqual(registry.listResources('schema'), ['alpha.note', 'zeta.note']);
  assert.equal(registry.resolve('validator', 'alpha.safe')?.name, 'safe');
  assert.equal(registry.resolve('validator', 'alpha.missing'), undefined);
});

test('unregister removes schema bridge and all extension resources', () => {
  const registry = new ExtensionRegistry();
  registry.register(extension('temporary', 'temporary'));
  assert.equal(registry.schemas.find('temporary.note')?.ref.id, 'temporary.note');
  registry.unregister('temporary');
  assert.equal(registry.has('temporary'), false);
  assert.equal(registry.resolve('validator', 'temporary.safe'), undefined);
  assert.equal(registry.schemas.find('temporary.note'), undefined);
});
