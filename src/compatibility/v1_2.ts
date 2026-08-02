/**
 * v1.2 compatibility boundary.
 *
 * This module deliberately owns the translation from the v1.2 representations
 * (Pmem.open options, Markdown cards, and manifests) to a small structural
 * candidate contract.  It does not import the Runtime implementation and it
 * does not make the legacy domain model part of the new Runtime API.
 *
 * Public adapters return the canonical Runtime model. Legacy-only details are
 * retained in explicitly named DTOs, so v1.2 conditionals do not spread into
 * Runtime callers.
 */

import * as path from 'node:path';
import { resolveConfig, V064_DEFAULT_TYPES } from '../core/manifest';
import type { CardFrontmatter, MemoryCard, Manifest } from '../types';
import type { MemoryRecord, MemorySchema, MemorySchemaField } from '../runtime/model';
import type { PartialRuntimeConfig, CapabilitySet, PmemOpenOptions } from '../runtime/types';

export const V1_2_COMPATIBILITY_VERSION = '1.2';

export type CompatibilityErrorCode =
  | 'INVALID_OPEN_OPTIONS'
  | 'INVALID_CARD'
  | 'INVALID_RECORD'
  | 'INVALID_MANIFEST'
  | 'UNSUPPORTED_VERSION';

export class CompatibilityError extends Error {
  readonly code: CompatibilityErrorCode;
  readonly field?: string;

  constructor(code: CompatibilityErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'CompatibilityError';
    this.code = code;
    this.field = field;
  }
}

/** Structural v1.3 candidate for Runtime.open(). */
export interface CanonicalOpenOptionsCandidate extends PmemOpenOptions {
  compatibility: {
    source: typeof V1_2_COMPATIBILITY_VERSION;
    legacyRoot: string;
  };
}

/** Official v1.3 model returned by the compatibility adapter. */
export type CanonicalMemoryRecordCandidate = MemoryRecord;

/** Legacy schema projection retained for callers that need v1.2 manifest details. */
export interface LegacyManifestSchema {
  id: string;
  version: string;
  cardTypes: readonly string[];
  typeDirectories: Readonly<Record<string, string>>;
  foundationalTypes: readonly string[];
  evidenceTypes: readonly string[];
  defaultType: string;
  creatableTypes: readonly string[];
  source: { kind: 'v1.2-manifest'; domain?: string };
}

export type V12OpenOptions = {
  root?: unknown;
  /** v1.2 callers occasionally passed `${root}/.pmem`; accepted as a legacy alias. */
  pmemPath?: unknown;
  preset?: unknown;
  config?: unknown;
  capabilities?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function requireString(value: unknown, code: CompatibilityErrorCode, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CompatibilityError(code, `Compatibility field '${field}' must be a non-empty string.`, field);
  }
  return value;
}

function requireText(value: unknown, code: CompatibilityErrorCode, field: string): string {
  if (typeof value !== 'string') {
    throw new CompatibilityError(code, `Compatibility field '${field}' must be a string.`, field);
  }
  return value;
}

function optionalString(value: unknown, code: CompatibilityErrorCode, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, code, field);
}

/**
 * Convert v1.2 Pmem.open options to the candidate Runtime contract.
 *
 * `root` remains the canonical project root.  A legacy `pmemPath` is accepted
 * only when `root` is absent; a conflicting pair fails closed instead of
 * silently opening the wrong project.
 */
export function v12OpenOptionsToCanonical(input: unknown): CanonicalOpenOptionsCandidate {
  if (!isRecord(input)) {
    throw new CompatibilityError('INVALID_OPEN_OPTIONS', 'v1.2 Pmem.open options must be an object.');
  }

  const rootValue = input.root;
  const pmemPathValue = input.pmemPath;
  const root = rootValue === undefined
    ? undefined
    : requireString(rootValue, 'INVALID_OPEN_OPTIONS', 'root');
  const pmemPath = pmemPathValue === undefined
    ? undefined
    : requireString(pmemPathValue, 'INVALID_OPEN_OPTIONS', 'pmemPath');

  if (!root && !pmemPath) {
    throw new CompatibilityError('INVALID_OPEN_OPTIONS', "v1.2 Pmem.open options require 'root'.", 'root');
  }

  const legacyRoot = root ?? path.dirname(pmemPath!);
  if (root && pmemPath) {
    const expectedPmemPath = path.resolve(root, '.pmem');
    if (path.resolve(pmemPath) !== expectedPmemPath) {
      throw new CompatibilityError(
        'INVALID_OPEN_OPTIONS',
        `Conflicting v1.2 root '${root}' and pmemPath '${pmemPath}'.`,
        'pmemPath',
      );
    }
  }

  const preset = optionalString(input.preset, 'INVALID_OPEN_OPTIONS', 'preset');
  let config: Record<string, unknown> | undefined;
  if (input.config !== undefined && input.config !== null) {
    if (!isRecord(input.config)) {
      throw new CompatibilityError('INVALID_OPEN_OPTIONS', "Compatibility field 'config' must be an object.", 'config');
    }
    config = cloneRecord(input.config);
  }

  let capabilities: readonly unknown[] | undefined;
  if (input.capabilities !== undefined && input.capabilities !== null) {
    if (!Array.isArray(input.capabilities)) {
      throw new CompatibilityError('INVALID_OPEN_OPTIONS', "Compatibility field 'capabilities' must be an array.", 'capabilities');
    }
    capabilities = [...input.capabilities];
  }

  return {
    root: legacyRoot,
    preset,
    config: config as PartialRuntimeConfig | undefined,
    capabilities: capabilities as CapabilitySet[] | undefined,
    compatibility: { source: V1_2_COMPATIBILITY_VERSION, legacyRoot },
  };
}

function normalizeCard(value: unknown): {
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
} {
  if (!isRecord(value)) {
    throw new CompatibilityError('INVALID_CARD', 'v1.2 card must be an object.');
  }
  if (!isRecord(value.frontmatter)) {
    throw new CompatibilityError('INVALID_CARD', "v1.2 card is missing an object 'frontmatter'.", 'frontmatter');
  }
  const frontmatter = cloneRecord(value.frontmatter);
  requireString(frontmatter.id, 'INVALID_CARD', 'frontmatter.id');
  requireString(frontmatter.type, 'INVALID_CARD', 'frontmatter.type');
  // Empty Markdown bodies are valid v1.2 cards; only an absent/non-string body
  // is a compatibility error.
  const body = requireText(value.body, 'INVALID_CARD', 'body');
  const filePath = requireString(value.filePath, 'INVALID_CARD', 'filePath');
  return { frontmatter, body, filePath };
}

export function v12CardToRecord(value: unknown): CanonicalMemoryRecordCandidate {
  const card = normalizeCard(value);
  const cardId = String(card.frontmatter.id);
  const schema = String(card.frontmatter.type);
  const schemaVersion = optionalString(card.frontmatter.schema_version, 'INVALID_CARD', 'frontmatter.schema_version');
  const now = String(card.frontmatter.updated ?? card.frontmatter.last_verified ?? '1970-01-01T00:00:00.000Z');
  const relations = [
    ...(Array.isArray(card.frontmatter.related) ? card.frontmatter.related.filter((target): target is string => typeof target === 'string').map(toRelation(cardId, 'related')) : []),
    ...(Array.isArray(card.frontmatter.depends_on) ? card.frontmatter.depends_on.filter((target): target is string => typeof target === 'string').map(toRelation(cardId, 'depends_on')) : []),
  ];
  return {
    id: cardId,
    schema: { id: schema, version: schemaVersion ?? '1' },
    data: { ...card.frontmatter, body: card.body },
    scope: 'workspace',
    provenance: {
      source: 'markdown',
      source_id: card.filePath,
      metadata: { file_path: card.filePath, compatibility: V1_2_COMPATIBILITY_VERSION },
    },
    created_at: now,
    updated_at: now,
    ...(typeof card.frontmatter.status === 'string' ? { state: card.frontmatter.status } : {}),
    ...(typeof card.frontmatter.version === 'number' ? { version: card.frontmatter.version } : {}),
    ...(relations.length > 0 ? { relations } : {}),
  };
}

function toRelation(fromId: string, type: string): (target: string) => { from_id: string; to_id: string; type: string } {
  return (target: string) => ({ from_id: fromId, to_id: target, type });
}

function normalizeRecord(value: unknown): CanonicalMemoryRecordCandidate {
  if (!isRecord(value)) {
    throw new CompatibilityError('INVALID_RECORD', 'Canonical memory record must be an object.');
  }
  const id = requireString(value.id, 'INVALID_RECORD', 'id');
  if (!isRecord(value.schema)) {
    throw new CompatibilityError('INVALID_RECORD', "Canonical memory record is missing object 'schema'.", 'schema');
  }
  const schemaId = requireString(value.schema.id, 'INVALID_RECORD', 'schema.id');
  const schemaVersion = requireString(value.schema.version, 'INVALID_RECORD', 'schema.version');
  if (!isRecord(value.data)) {
    throw new CompatibilityError('INVALID_RECORD', "Canonical memory record is missing object 'data'.", 'data');
  }
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  const filePath = typeof provenance.source_id === 'string'
    ? provenance.source_id
    : isRecord(provenance.metadata) && typeof provenance.metadata.file_path === 'string'
      ? provenance.metadata.file_path
      : undefined;
  if (!filePath) {
    throw new CompatibilityError('INVALID_RECORD', "Canonical memory record is missing Markdown provenance source_id.", 'provenance.source_id');
  }
  const data = cloneRecord(value.data);
  const body = data.body === undefined ? '' : requireText(data.body, 'INVALID_RECORD', 'data.body');
  delete data.body;
  if (data.id !== undefined && data.id !== id) {
    throw new CompatibilityError(
      'INVALID_RECORD',
      `Record data must agree with id '${id}'.`,
      'data.id',
    );
  }
  if (data.type !== undefined && data.type !== schemaId) {
    throw new CompatibilityError('INVALID_RECORD', `Record data must agree with schema '${schemaId}'.`, 'data.type');
  }
  return {
    ...value as unknown as MemoryRecord,
    id,
    schema: { id: schemaId, version: schemaVersion },
    data: { ...data, body },
    provenance: value.provenance as MemoryRecord['provenance'],
  };
}

export function recordToV12Card(value: unknown, filePathOverride?: string): MemoryCard {
  const record = normalizeRecord(value);
  const filePath = requireString(filePathOverride ?? record.provenance.source_id, 'INVALID_RECORD', 'filePath');
  const attributes = cloneRecord(record.data);
  const body = typeof attributes.body === 'string' ? attributes.body : '';
  delete attributes.body;
  attributes.id ??= record.id;
  attributes.type ??= record.schema.id;
  return {
    frontmatter: attributes as unknown as CardFrontmatter,
    body,
    filePath,
  };
}

function readManifestVersion(manifest: Record<string, unknown>): string {
  const pmem = manifest.pmem;
  if (!isRecord(pmem)) {
    throw new CompatibilityError('INVALID_MANIFEST', "v1.2 manifest is missing object 'pmem'.", 'pmem');
  }
  const schemaVersion = optionalString(pmem.schema_version, 'INVALID_MANIFEST', 'pmem.schema_version');
  const protocolVersion = optionalString(pmem.protocol_version, 'INVALID_MANIFEST', 'pmem.protocol_version');
  const version = schemaVersion ?? protocolVersion;
  if (!version) {
    throw new CompatibilityError('INVALID_MANIFEST', 'v1.2 manifest is missing pmem.schema_version.', 'pmem.schema_version');
  }
  if (version !== '0.2' && version !== '0.3') {
    throw new CompatibilityError('UNSUPPORTED_VERSION', `Unsupported v1.2 manifest version '${version}'.`, 'pmem.schema_version');
  }
  return version;
}

export function v12ManifestToLegacySchema(value: unknown): LegacyManifestSchema {
  if (!isRecord(value)) {
    throw new CompatibilityError('INVALID_MANIFEST', 'v1.2 manifest must be an object.');
  }
  const version = readManifestVersion(value);
  if (!isRecord(value.project)) {
    throw new CompatibilityError('INVALID_MANIFEST', "v1.2 manifest is missing object 'project'.", 'project');
  }
  const projectName = requireString(value.project.name, 'INVALID_MANIFEST', 'project.name');
  const domain = optionalString(value.project.domain, 'INVALID_MANIFEST', 'project.domain');

  // resolveConfig is the legacy resolver. Keeping that call here makes this
  // the sole compatibility boundary for presets and v0.6 fallback defaults.
  const resolved = resolveConfig(value as unknown as Manifest);
  const cardTypes = resolved.card_types.length > 0 ? [...resolved.card_types] : [...V064_DEFAULT_TYPES];
  return {
    id: projectName,
    version,
    cardTypes,
    typeDirectories: { ...resolved.type_dirs },
    foundationalTypes: [...resolved.foundational_types],
    evidenceTypes: [...resolved.evidence_types],
    defaultType: resolved.default_type,
    creatableTypes: [...resolved.creatable_types],
    source: { kind: 'v1.2-manifest', ...(domain ? { domain } : {}) },
  };
}

/** Convert a v1.2 manifest into the official v1.3 Runtime schema contract. */
export function v12ManifestToSchema(value: unknown): MemorySchema {
  const legacy = v12ManifestToLegacySchema(value);
  const fields: readonly MemorySchemaField[] = [
    { name: 'id', type: 'string', required: true, indexed: true },
    { name: 'type', type: 'string', required: true, indexed: true },
    { name: 'body', type: 'text', searchable: true },
  ];
  return {
    ref: { id: `legacy.${legacy.id}`, version: legacy.version },
    fields,
    metadata: {
      card_types: [...legacy.cardTypes],
      type_dirs: { ...legacy.typeDirectories },
      foundational_types: [...legacy.foundationalTypes],
      evidence_types: [...legacy.evidenceTypes],
      default_type: legacy.defaultType,
      creatable_types: [...legacy.creatableTypes],
      source: legacy.source,
    },
  };
}

/** Explicit aliases make the adapter discoverable while keeping the v1.2 prefix. */
export const toCanonicalOpenOptions = v12OpenOptionsToCanonical;
export const toCanonicalRecord = v12CardToRecord;
export const fromCanonicalRecord = recordToV12Card;
export const toCanonicalSchema = v12ManifestToSchema;
