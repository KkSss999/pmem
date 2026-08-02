import {
  DuplicateSchemaError,
  BuiltinSchemaError,
  InvalidSchemaError,
  SchemaValidationError,
  UnknownSchemaError,
} from './errors';
import { BUILTIN_SCHEMAS } from './builtins';
import type {
  MemoryFieldDefinition,
  MemoryRecordLike,
  MemorySchema,
  MemorySchemaDefinition,
  MemorySchemaField,
  MemorySchemaRef,
  SchemaFieldType,
  SchemaValidationIssue,
  SchemaValidationResult,
  SchemaVersion,
} from './types';

export type SchemaInput = MemorySchema | MemorySchemaDefinition;
export type SchemaRefInput = string | MemorySchemaRef | { id?: string; name?: string; version?: string };

function parseVersion(version: string): { major: number; minor: number; patch: number; suffix: string } | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?((?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(version.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0), suffix: match[4] ?? '' };
}

/** Normalize equivalent `1`, `1.0`, and `1.0.0` keys without changing output. */
export function normalizeSchemaVersion(version: SchemaVersion): string {
  if (typeof version !== 'string' || !version.trim()) throw new InvalidSchemaError('Schema version must be a non-empty semver-like string');
  const parsed = parseVersion(version);
  if (!parsed) throw new InvalidSchemaError(`Invalid schema version "${version}"`);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.suffix}`;
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)!;
  const b = parseVersion(right)!;
  for (const key of ['major', 'minor', 'patch'] as const) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.suffix.startsWith('-') && b.suffix.startsWith('-')) return 1;
  if (a.suffix.startsWith('-') && !b.suffix.startsWith('-')) return -1;
  return a.suffix.localeCompare(b.suffix);
}

function isFieldType(type: unknown): type is SchemaFieldType {
  return typeof type === 'string' && type.length > 0;
}

function schemaId(schema: MemorySchema): string { return schema.ref.id; }
function schemaVersion(schema: MemorySchema): string { return schema.ref.version; }

function normalizeField(name: string, field: MemoryFieldDefinition): MemorySchemaField {
  if (!field || typeof field !== 'object' || !isFieldType(field.type)) throw new InvalidSchemaError(`Field "${name}" has an invalid type`);
  const { nullable, enum: values, minLength, maxLength, min, max, items, default: defaultValue, ...canonical } = field;
  const validation = { nullable, enum: values, minLength, maxLength, min, max, items, default: defaultValue };
  const metadata = Object.fromEntries(Object.entries({ ...field.metadata, validation }).filter(([, value]) => value !== undefined));
  return {
    ...canonical,
    name: field.name ?? name,
    type: field.type,
    metadata: Object.keys(metadata).length ? metadata : field.metadata,
  };
}

function normalizeSchema(input: SchemaInput): MemorySchema {
  if (isCanonicalSchema(input)) {
    validateSchemaDefinition(input);
    return Object.freeze({ ...input, fields: Object.freeze(input.fields.map((field) => Object.freeze({ ...field }))) });
  }
  const id = input.id ?? input.name;
  if (!id) throw new InvalidSchemaError('Schema must define id or name');
  const rawFields = Array.isArray(input.fields)
    ? input.fields.map((field, index) => [field.name ?? String(index), field] as const)
    : Object.entries(input.fields);
  const fields = rawFields.map(([name, field]) => normalizeField(name, field));
  const schema: MemorySchema = {
    ref: { id, version: input.version },
    fields,
    description: input.description,
    metadata: { ...input.metadata, ...(input.source ? { source: input.source } : {}), ...(input.strict !== undefined ? { strict: input.strict } : {}), ...(input.relations ? { relations: input.relations } : {}) },
  };
  validateSchemaDefinition(schema);
  return Object.freeze({ ...schema, fields: Object.freeze(fields.map((field) => Object.freeze(field))) });
}

function validateSchemaDefinition(schema: MemorySchema): void {
  if (!schema || typeof schema !== 'object' || !schema.ref || typeof schema.ref !== 'object') throw new InvalidSchemaError('Schema must define a ref object');
  if (typeof schema.ref.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(schema.ref.id)) throw new InvalidSchemaError('Schema ref.id must start with a letter and contain only letters, digits, ., _, or -');
  normalizeSchemaVersion(schema.ref.version);
  if (!Array.isArray(schema.fields)) throw new InvalidSchemaError(`Schema "${schema.ref.id}" must define a fields array`);
  const names = new Set<string>();
  for (const field of schema.fields) {
    if (!field || typeof field.name !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(field.name)) throw new InvalidSchemaError(`Invalid field name in schema "${schema.ref.id}"`);
    if (names.has(field.name)) throw new InvalidSchemaError(`Duplicate field "${schema.ref.id}.${field.name}"`);
    names.add(field.name);
    if (!isFieldType(field.type)) throw new InvalidSchemaError(`Field "${schema.ref.id}.${field.name}" has an invalid type`);
  }
}

function isCanonicalSchema(value: SchemaInput): value is MemorySchema {
  return typeof value === 'object' && value !== null && 'ref' in value && 'fields' in value && Array.isArray(value.fields);
}

function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function valuesForRecord(record: unknown): Record<string, unknown> | undefined {
  if (!isObject(record)) return undefined;
  if (isObject(record.data)) return record.data;
  if (isObject(record.fields)) return record.fields;
  return record;
}
function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
}
function fieldValidation(field: MemorySchemaField): MemoryFieldDefinition {
  const metadata = isObject(field.metadata) ? field.metadata : {};
  const validation = isObject(metadata.validation) ? metadata.validation : {};
  return { ...field, ...(validation as Partial<MemoryFieldDefinition>) };
}
function validateField(path: string, value: unknown, field: MemoryFieldDefinition): SchemaValidationIssue[] {
  if (value === null) return field.nullable ? [] : [{ path, code: 'invalid_type', message: 'must not be null', expected: field.type, actual: 'null' }];
  if (value === undefined) return [];
  const issues: SchemaValidationIssue[] = [];
  const type = field.type;
  const typeMatches = type === 'json' || type === 'unknown' || (type === 'id' && typeof value === 'string' && value.length > 0) || (type === 'date' && (value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value))))) || (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) || (type === 'number' && typeof value === 'number' && Number.isFinite(value)) || ((type === 'string' || type === 'text') && typeof value === 'string') || (type === 'boolean' && typeof value === 'boolean') || (type === 'object' && isObject(value)) || (type === 'array' && Array.isArray(value));
  if (!typeMatches) { issues.push({ path, code: 'invalid_type', message: `must be ${type}`, expected: type, actual: actualType(value) }); return issues; }
  if (field.enum && !field.enum.some((candidate) => Object.is(candidate, value))) issues.push({ path, code: 'invalid_value', message: 'must be one of the declared values', expected: field.enum, actual: value });
  if (typeof value === 'string') {
    if (field.minLength !== undefined && value.length < field.minLength) issues.push({ path, code: 'invalid_length', message: `must have at least ${field.minLength} characters`, expected: field.minLength, actual: value.length });
    if (field.maxLength !== undefined && value.length > field.maxLength) issues.push({ path, code: 'invalid_length', message: `must have at most ${field.maxLength} characters`, expected: field.maxLength, actual: value.length });
  }
  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) issues.push({ path, code: 'out_of_range', message: `must be at least ${field.min}`, expected: field.min, actual: value });
    if (field.max !== undefined && value > field.max) issues.push({ path, code: 'out_of_range', message: `must be at most ${field.max}`, expected: field.max, actual: value });
  }
  if (type === 'array' && field.items) (value as unknown[]).forEach((item, index) => issues.push(...validateField(`${path}[${index}]`, item, field.items!)));
  return issues;
}

export class SchemaRegistry {
  private readonly schemas = new Map<string, Map<string, MemorySchema>>();
  constructor(input: SchemaInput | readonly SchemaInput[] = BUILTIN_SCHEMAS) {
    const schemas: readonly SchemaInput[] = Array.isArray(input) ? input : [input];
    for (const schema of schemas) this.register(schema);
  }
  register(input: SchemaInput): void {
    const schema = normalizeSchema(input);
    const id = schemaId(schema);
    const versionKey = normalizeSchemaVersion(schemaVersion(schema));
    const byVersion = this.schemas.get(id) ?? new Map<string, MemorySchema>();
    if (byVersion.has(versionKey)) throw new DuplicateSchemaError(id, schemaVersion(schema));
    byVersion.set(versionKey, schema);
    this.schemas.set(id, byVersion);
  }
  registerAll(inputs: readonly SchemaInput[]): this { for (const input of inputs) this.register(input); return this; }
  /** Explicit alias for v1.2 adapters and external-style extensions. */
  registerCompatibility(input: SchemaInput | readonly SchemaInput[]): this {
    if (Array.isArray(input)) this.registerAll(input as readonly SchemaInput[]);
    else this.register(input as SchemaInput);
    return this;
  }
  /** Remove a non-builtin schema. Builtins are immutable process contracts. */
  unregister(ref: SchemaRefInput): boolean {
    const parsed = this.parseRef(ref);
    if (!parsed.version) throw new InvalidSchemaError('Schema unregister requires an explicit version');
    const versions = this.schemas.get(parsed.id);
    if (!versions) throw new UnknownSchemaError(parsed.id, parsed.version);
    const normalized = normalizeSchemaVersion(parsed.version);
    const schema = versions.get(normalized);
    if (!schema) throw new UnknownSchemaError(parsed.id, parsed.version);
    if (isBuiltin(schema)) throw new BuiltinSchemaError(parsed.id, schema.ref.version);
    versions.delete(normalized);
    if (versions.size === 0) this.schemas.delete(parsed.id);
    return true;
  }
  has(ref: SchemaRefInput): boolean { const parsed = this.parseRef(ref); const versions = this.schemas.get(parsed.id); return !!versions && (!parsed.version || versions.has(normalizeSchemaVersion(parsed.version))); }
  get(ref: SchemaRefInput): MemorySchema {
    const parsed = this.parseRef(ref); const versions = this.schemas.get(parsed.id);
    if (!versions || versions.size === 0) throw new UnknownSchemaError(parsed.id, parsed.version);
    if (parsed.version) { const schema = versions.get(normalizeSchemaVersion(parsed.version)); if (!schema) throw new UnknownSchemaError(parsed.id, parsed.version); return schema; }
    return [...versions.values()].sort((left, right) => compareVersions(schemaVersion(right), schemaVersion(left)))[0];
  }
  find(ref: SchemaRefInput): MemorySchema | undefined { try { return this.get(ref); } catch (error) { if (error instanceof UnknownSchemaError) return undefined; throw error; } }
  /** Runtime/model's registry port uses null for a missing schema. */
  resolve(ref: MemorySchemaRef): MemorySchema | null { return this.find(ref) ?? null; }
  versions(id: string): readonly SchemaVersion[] { return [...(this.schemas.get(id)?.values() ?? [])].sort((left, right) => compareVersions(schemaVersion(left), schemaVersion(right))).map(schemaVersion); }
  list(): readonly MemorySchema[] { return [...this.schemas.values()].flatMap((versions) => [...versions.values()]).sort((left, right) => schemaId(left).localeCompare(schemaId(right)) || compareVersions(schemaVersion(left), schemaVersion(right))); }
  validate(ref: SchemaRefInput | MemorySchema, record: unknown): SchemaValidationResult {
    const schema = isCanonicalSchema(ref as SchemaInput) ? ref as MemorySchema : this.get(ref as SchemaRefInput);
    const values = valuesForRecord(record); const issues: SchemaValidationIssue[] = [];
    if (!values) return { valid: false, schema: schemaId(schema), version: schemaVersion(schema), issues: [{ path: '$', code: 'invalid_record', message: 'must be an object', actual: actualType(record) }] };
    for (const field of schema.fields) {
      const definition = fieldValidation(field); const value = values[field.name];
      if (value === undefined) { if (field.required && definition.default === undefined) issues.push({ path: field.name, code: 'missing_field', message: 'is required', expected: field.type }); }
      else issues.push(...validateField(field.name, value, definition));
    }
    const metadata = isObject(schema.metadata) ? schema.metadata : {};
    if (metadata.strict === true) for (const name of Object.keys(values)) if (!schema.fields.some((field) => field.name === name)) issues.push({ path: name, code: 'unknown_field', message: 'is not declared by this schema', actual: values[name] });
    return { valid: issues.length === 0, schema: schemaId(schema), version: schemaVersion(schema), issues };
  }
  assertValid(ref: SchemaRefInput | MemorySchema, record: unknown): void { const result = this.validate(ref, record); if (!result.valid) throw new SchemaValidationError(result.schema, result.version, result.issues); }
  private parseRef(ref: SchemaRefInput): { id: string; version?: string } {
    if (typeof ref === 'object' && ref !== null) { const id = ref.id ?? ('name' in ref ? ref.name : undefined); if (!id) throw new UnknownSchemaError(''); return { id, version: ref.version }; }
    if (typeof ref !== 'string' || !ref.trim()) throw new UnknownSchemaError(String(ref));
    const at = ref.lastIndexOf('@'); return at > 0 ? { id: ref.slice(0, at), version: ref.slice(at + 1) } : { id: ref };
  }
}

function isBuiltin(schema: MemorySchema): boolean {
  return isObject(schema.metadata) && schema.metadata.source === 'builtin';
}
