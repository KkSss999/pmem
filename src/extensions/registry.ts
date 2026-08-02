import { SchemaRegistry } from '../schema';
import type { MemorySchema, MemorySchemaRef } from '../schema';
import {
  DuplicateExtensionError, DuplicateExtensionResourceError, ExtensionPermissionError,
  InvalidExtensionError, UnknownExtensionError, UnknownExtensionResourceError,
} from './errors';
import type {
  ExtensionCapability, ExtensionContext, ExtensionHealthCheck, ExtensionHook, ExtensionKind,
  ExtensionProjector, ExtensionRegistrationOptions, ExtensionRetriever, ExtensionValidator,
  MemoryExtension,
} from './types';

type Resource = ExtensionValidator | ExtensionRetriever | ExtensionProjector | ExtensionHealthCheck | ExtensionHook;
const KINDS: readonly ExtensionKind[] = ['schema', 'validator', 'retriever', 'projector', 'health', 'hook'];
const NAME = /^[A-Za-z][A-Za-z0-9._-]*$/;

function key(namespace: string, name: string): string { return `${namespace}.${name}`; }
function assertName(label: string, value: unknown): asserts value is string { if (typeof value !== 'string' || !NAME.test(value)) throw new InvalidExtensionError(`${label} must start with a letter and contain only letters, digits, ., _, or -`); }
function resourceCapability(kind: ExtensionKind): ExtensionCapability { return `${kind}.register` as ExtensionCapability; }

/** Registry and execution boundary for externally supplied extension resources. */
export class ExtensionRegistry {
  private readonly extensions = new Map<string, MemoryExtension>();
  private readonly namespaces = new Map<string, string>();
  private readonly resources = new Map<ExtensionKind, Map<string, Resource | MemorySchema>>(
    KINDS.map((kind) => [kind, new Map<string, Resource | MemorySchema>()]),
  );
  private readonly schemaRefs = new Map<string, readonly MemorySchemaRef[]>();
  readonly schemas: SchemaRegistry;

  constructor(schemaRegistry: SchemaRegistry = new SchemaRegistry()) { this.schemas = schemaRegistry; }

  register(extension: MemoryExtension, options: ExtensionRegistrationOptions = {}): this {
    this.validateExtension(extension, options);
    if (this.extensions.has(extension.id)) throw new DuplicateExtensionError(extension.id);
    const owner = this.namespaces.get(extension.namespace);
    if (owner && owner !== extension.id) throw new DuplicateExtensionResourceError('namespace', extension.namespace);
    const staged: Array<{ kind: ExtensionKind; key: string; value: Resource | MemorySchema }> = [];
    const add = (kind: ExtensionKind, name: string, value: Resource | MemorySchema) => {
      assertName(`${kind}.name`, name);
      const scoped = key(extension.namespace, name);
      if (this.resources.get(kind)!.has(scoped) || staged.some((item) => item.kind === kind && item.key === scoped)) throw new DuplicateExtensionResourceError(kind, scoped);
      staged.push({ kind, key: scoped, value });
    };
    const normalizedSchemas: MemorySchema[] = [];
    for (const schemaInput of extension.schemas ?? []) {
      const temp = new SchemaRegistry([]);
      temp.register(schemaInput);
      const normalized = temp.list()[0];
      const localId = normalized.ref.id.startsWith(`${extension.namespace}.`)
        ? normalized.ref.id.slice(extension.namespace.length + 1)
        : normalized.ref.id;
      const scopedId = key(extension.namespace, localId);
      if (this.schemas.has({ id: scopedId, version: normalized.ref.version })) throw new DuplicateExtensionResourceError('schema', `${scopedId}@${normalized.ref.version}`);
      const scoped: MemorySchema = Object.freeze({ ...normalized, ref: { id: scopedId, version: normalized.ref.version }, metadata: { ...normalized.metadata, extension_id: extension.id, namespace: extension.namespace } });
      normalizedSchemas.push(scoped); add('schema', localId, scoped);
    }
    for (const [kind, values] of this.resourcesFor(extension)) for (const resource of values) add(kind, resource.name, resource);
    // All checks happen before mutating either registry, so a failed extension
    // cannot leave a half-installed resource set behind.
    for (const schema of normalizedSchemas) this.schemas.register(schema);
    this.extensions.set(extension.id, extension);
    this.namespaces.set(extension.namespace, extension.id);
    this.schemaRefs.set(extension.id, normalizedSchemas.map((schema) => schema.ref));
    for (const item of staged) this.resources.get(item.kind)!.set(item.key, item.value);
    return this;
  }

  unregister(id: string): void {
    const extension = this.extensions.get(id); if (!extension) throw new UnknownExtensionError(id);
    for (const ref of this.schemaRefs.get(id) ?? []) this.schemas.unregister(ref);
    this.schemaRefs.delete(id);
    this.extensions.delete(id); this.namespaces.delete(extension.namespace);
    for (const kind of KINDS) for (const resourceKey of this.resources.get(kind)!.keys()) if (resourceKey.startsWith(`${extension.namespace}.`)) this.resources.get(kind)!.delete(resourceKey);
  }
  get(id: string): MemoryExtension { const extension = this.extensions.get(id); if (!extension) throw new UnknownExtensionError(id); return extension; }
  has(id: string): boolean { return this.extensions.has(id); }
  list(): readonly MemoryExtension[];
  list(kind: ExtensionKind): readonly string[];
  list(kind?: ExtensionKind): readonly MemoryExtension[] | readonly string[] { return kind ? this.listResources(kind) : [...this.extensions.values()].sort((left, right) => left.id.localeCompare(right.id)); }
  listResources(kind: ExtensionKind): readonly string[] { if (!KINDS.includes(kind)) throw new InvalidExtensionError(`Unknown resource kind "${kind}"`); return [...this.resources.get(kind)!.keys()].sort(); }
  resolve(kind: 'schema', scopedName: string): MemorySchema | undefined;
  resolve(kind: 'validator', scopedName: string): ExtensionValidator | undefined;
  resolve(kind: 'retriever', scopedName: string): ExtensionRetriever | undefined;
  resolve(kind: 'projector', scopedName: string): ExtensionProjector | undefined;
  resolve(kind: 'health', scopedName: string): ExtensionHealthCheck | undefined;
  resolve(kind: 'hook', scopedName: string): ExtensionHook | undefined;
  resolve(kind: ExtensionKind, scopedName: string): Resource | MemorySchema | undefined { return this.resources.get(kind)?.get(scopedName) as Resource | MemorySchema | undefined; }
  require(kind: 'schema', scopedName: string): MemorySchema;
  require(kind: 'validator', scopedName: string): ExtensionValidator;
  require(kind: 'retriever', scopedName: string): ExtensionRetriever;
  require(kind: 'projector', scopedName: string): ExtensionProjector;
  require(kind: 'health', scopedName: string): ExtensionHealthCheck;
  require(kind: 'hook', scopedName: string): ExtensionHook;
  require(kind: ExtensionKind, scopedName: string): Resource | MemorySchema { const resource = this.resources.get(kind)?.get(scopedName) as Resource | MemorySchema | undefined; if (!resource) throw new UnknownExtensionResourceError(kind, scopedName); return resource; }
  context(extensionId: string): ExtensionContext { const extension = this.get(extensionId); return { extensionId: extension.id, namespace: extension.namespace }; }

  private validateExtension(extension: MemoryExtension, options: ExtensionRegistrationOptions): void {
    if (!extension || typeof extension !== 'object') throw new InvalidExtensionError('Extension must be an object');
    assertName('extension.id', extension.id); assertName('extension.namespace', extension.namespace);
    if (typeof extension.version !== 'string' || !extension.version.trim()) throw new InvalidExtensionError('extension.version must be a non-empty string');
    if (this.namespaces.has(extension.namespace) && this.namespaces.get(extension.namespace) !== extension.id) throw new DuplicateExtensionResourceError('namespace', extension.namespace);
    const allowed = options.allowedNamespaces ?? [extension.namespace];
    if (!allowed.includes(extension.namespace)) throw new ExtensionPermissionError(`Namespace "${extension.namespace}" is not allowed`);
    const declared = options.grantedCapabilities ?? extension.capabilities;
    if (declared) for (const kind of this.resourceKinds(extension)) if (!declared.includes(resourceCapability(kind))) throw new ExtensionPermissionError(`Capability "${resourceCapability(kind)}" is required for ${kind} resources`);
  }
  private resourceKinds(extension: MemoryExtension): ExtensionKind[] { const kinds: ExtensionKind[] = []; if (extension.schemas?.length) kinds.push('schema'); if (extension.validators?.length) kinds.push('validator'); if (extension.retrievers?.length) kinds.push('retriever'); if (extension.projectors?.length) kinds.push('projector'); if (extension.healthChecks?.length) kinds.push('health'); if (extension.hooks?.length) kinds.push('hook'); return kinds; }
  private resourcesFor(extension: MemoryExtension): Array<[ExtensionKind, readonly Resource[]]> {
    return [
      ['validator', extension.validators ?? []], ['retriever', extension.retrievers ?? []],
      ['projector', extension.projectors ?? []], ['health', extension.healthChecks ?? []], ['hook', extension.hooks ?? []],
    ];
  }
}
