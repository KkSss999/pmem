/**
 * Schema-layer helpers for the canonical model in `runtime/model.ts`.
 *
 * `MemorySchema` and `MemorySchemaRef` are aliases to the Runtime contract;
 * this package must not define a second schema model.  The input definition
 * below is intentionally convenient for extensions and v1.2 compatibility
 * adapters, and is normalized to the canonical shape when registered.
 */
import type {
  MemorySchema as RuntimeMemorySchema,
  MemorySchemaField as RuntimeMemorySchemaField,
  MemorySchemaRef as RuntimeMemorySchemaRef,
} from '../runtime/model';

export type MemorySchema = RuntimeMemorySchema;
export type MemorySchemaRef = RuntimeMemorySchemaRef;
export type MemorySchemaField = RuntimeMemorySchemaField;
export type SchemaVersion = string;

export type SchemaFieldType =
  | 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'json'
  | 'relation' | 'object' | 'array' | 'id' | 'unknown' | (string & {});

export interface MemoryFieldDefinition {
  name?: string;
  type: SchemaFieldType;
  required?: boolean;
  indexed?: boolean;
  searchable?: boolean;
  nullable?: boolean;
  enum?: readonly unknown[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  items?: MemoryFieldDefinition;
  default?: unknown;
  description?: string;
  metadata?: Record<string, unknown>;
}
export type SchemaFieldDefinition = MemoryFieldDefinition;

export interface MemoryRelationDefinition {
  target: string;
  cardinality?: 'one' | 'many';
  required?: boolean;
  inverse?: string;
  description?: string;
}

/** A convenient extension/compatibility input; output is always MemorySchema. */
export interface MemorySchemaDefinition {
  id?: string;
  name?: string;
  version: SchemaVersion;
  description?: string;
  fields: Readonly<Record<string, MemoryFieldDefinition>> | readonly MemoryFieldDefinition[];
  relations?: Readonly<Record<string, MemoryRelationDefinition>>;
  strict?: boolean;
  metadata?: Record<string, unknown>;
  source?: string;
}

/** A record adapter can expose data directly, under `data`, or under `fields`. */
export interface MemoryRecordLike {
  schema?: MemorySchemaRef | string;
  schema_name?: string;
  schema_version?: SchemaVersion;
  data?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SchemaValidationCode =
  | 'invalid_record' | 'missing_field' | 'unknown_field' | 'invalid_type'
  | 'invalid_value' | 'invalid_length' | 'out_of_range' | 'invalid_version';

export interface SchemaValidationIssue {
  path: string;
  code: SchemaValidationCode;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface SchemaValidationResult {
  valid: boolean;
  schema: string;
  version: SchemaVersion;
  issues: readonly SchemaValidationIssue[];
}
