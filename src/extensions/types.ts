import type { MemoryBackend, MemoryRecord, MemorySchema } from '../runtime/model';
import type { SchemaInput, SchemaValidationResult } from '../schema';

export type ExtensionKind = 'schema' | 'validator' | 'retriever' | 'projector' | 'health' | 'hook';
export type ExtensionCapability = `${ExtensionKind}.register` | 'extension.execute';
export type ExtensionHookEvent = 'before_commit' | 'after_commit' | 'before_forget' | 'after_forget' | 'projection_error';

export interface ExtensionContext {
  readonly extensionId: string;
  readonly namespace: string;
  readonly backend?: MemoryBackend;
}

export interface ExtensionResourceBase {
  /** Local resource name; registry exposes `${namespace}.${name}`. */
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
}

export interface ExtensionValidator extends ExtensionResourceBase {
  readonly validate: (record: unknown, context: ExtensionContext) => SchemaValidationResult | void | Promise<SchemaValidationResult | void>;
}
export interface ExtensionRetriever extends ExtensionResourceBase {
  readonly retrieve: (query: unknown, context: ExtensionContext) => unknown | Promise<unknown>;
}
export interface ExtensionProjector extends ExtensionResourceBase {
  readonly project: (record: MemoryRecord, context: ExtensionContext) => unknown | Promise<unknown>;
}
export interface ExtensionHealthCheck extends ExtensionResourceBase {
  readonly check: (context: ExtensionContext) => unknown | Promise<unknown>;
}
export interface ExtensionHook extends ExtensionResourceBase {
  readonly event: ExtensionHookEvent;
  readonly run: (payload: unknown, context: ExtensionContext) => unknown | Promise<unknown>;
}

export interface MemoryExtension {
  /** Globally unique extension id. */
  readonly id: string;
  /** Namespace used for every resource owned by this extension. */
  readonly namespace: string;
  readonly version: string;
  readonly capabilities?: readonly ExtensionCapability[];
  readonly schemas?: readonly SchemaInput[];
  readonly validators?: readonly ExtensionValidator[];
  readonly retrievers?: readonly ExtensionRetriever[];
  readonly projectors?: readonly ExtensionProjector[];
  readonly healthChecks?: readonly ExtensionHealthCheck[];
  readonly hooks?: readonly ExtensionHook[];
}
/** Naming used by extension manifests in integration code. */
export type ExtensionManifest = MemoryExtension;

export interface ExtensionRegistrationOptions {
  /** Explicit allow-list; omission permits only the extension's own namespace. */
  readonly allowedNamespaces?: readonly string[];
  /** Granted capabilities; omission uses the extension's declared capabilities. */
  readonly grantedCapabilities?: readonly ExtensionCapability[];
}
