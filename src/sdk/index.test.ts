import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILTIN_SCHEMAS,
  EVENT_SCHEMA,
  MEMORY_SCHEMA,
  SchemaRegistry,
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
});
