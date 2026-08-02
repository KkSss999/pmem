export class ExtensionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ExtensionError'; this.code = code; }
}
export class DuplicateExtensionError extends ExtensionError {
  constructor(id: string) { super('EXTENSION_ALREADY_REGISTERED', `Extension "${id}" is already registered`); this.name = 'DuplicateExtensionError'; }
}
export class UnknownExtensionError extends ExtensionError {
  constructor(id: string) { super('EXTENSION_NOT_FOUND', `Unknown extension "${id}"`); this.name = 'UnknownExtensionError'; }
}
export class DuplicateExtensionResourceError extends ExtensionError {
  constructor(kind: string, key: string) { super('EXTENSION_RESOURCE_COLLISION', `${kind} resource "${key}" is already registered`); this.name = 'DuplicateExtensionResourceError'; }
}
export class UnknownExtensionResourceError extends ExtensionError {
  constructor(kind: string, key: string) { super('EXTENSION_RESOURCE_NOT_FOUND', `Unknown ${kind} resource "${key}"`); this.name = 'UnknownExtensionResourceError'; }
}
export class ExtensionPermissionError extends ExtensionError {
  constructor(message: string) { super('EXTENSION_PERMISSION_DENIED', message); this.name = 'ExtensionPermissionError'; }
}
export class InvalidExtensionError extends ExtensionError {
  constructor(message: string) { super('EXTENSION_INVALID', message); this.name = 'InvalidExtensionError'; }
}
