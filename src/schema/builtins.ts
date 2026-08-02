import type { MemorySchema } from './types';

/** Minimal generic schemas. Domain-specific presets are deliberately absent. */
export const MEMORY_SCHEMA: MemorySchema = Object.freeze({
  ref: { id: 'memory', version: '1.0.0' },
  primary_key: 'id',
  fields: Object.freeze([
    { name: 'id', type: 'id', required: true },
    { name: 'content', type: 'text', required: true, metadata: { validation: { minLength: 1 } } },
    { name: 'type', type: 'string' },
    { name: 'scope', type: 'string' },
    { name: 'provenance', type: 'json' },
    { name: 'lifecycle', type: 'string' },
    { name: 'created_at', type: 'date' },
    { name: 'updated_at', type: 'date' },
    { name: 'metadata', type: 'json' },
  ]),
  metadata: { source: 'builtin', strict: false, description: 'A durable memory record.' },
});

export const EVENT_SCHEMA: MemorySchema = Object.freeze({
  ref: { id: 'event', version: '1.0.0' },
  primary_key: 'id',
  fields: Object.freeze([
    { name: 'id', type: 'id', required: true },
    { name: 'type', type: 'string', required: true, metadata: { validation: { minLength: 1 } } },
    { name: 'scope', type: 'string' },
    { name: 'payload', type: 'json', required: true },
    { name: 'created_at', type: 'date', required: true },
    { name: 'record_id', type: 'id', nullable: true },
  ]),
  metadata: { source: 'builtin', strict: false, description: 'An append-only memory lifecycle event.' },
});

export const BUILTIN_SCHEMAS: readonly MemorySchema[] = Object.freeze([MEMORY_SCHEMA, EVENT_SCHEMA]);
