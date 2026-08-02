export class SchemaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SchemaError';
    this.code = code;
  }
}

export class DuplicateSchemaError extends SchemaError {
  readonly schemaName: string;
  readonly version: string;

  constructor(schemaName: string, version: string) {
    super('SCHEMA_ALREADY_REGISTERED', `Schema "${schemaName}@${version}" is already registered`);
    this.name = 'DuplicateSchemaError';
    this.schemaName = schemaName;
    this.version = version;
  }
}

export class UnknownSchemaError extends SchemaError {
  readonly schemaName: string;
  readonly version?: string;

  constructor(schemaName: string, version?: string) {
    const ref = version ? `${schemaName}@${version}` : schemaName;
    super('SCHEMA_NOT_FOUND', `Unknown schema "${ref}"`);
    this.name = 'UnknownSchemaError';
    this.schemaName = schemaName;
    this.version = version;
  }
}

export class InvalidSchemaError extends SchemaError {
  constructor(message: string) {
    super('SCHEMA_INVALID', message);
    this.name = 'InvalidSchemaError';
  }
}

export class BuiltinSchemaError extends SchemaError {
  constructor(schemaName: string, version: string) {
    super('BUILTIN_SCHEMA_PROTECTED', `Builtin schema "${schemaName}@${version}" cannot be unregistered`);
    this.name = 'BuiltinSchemaError';
  }
}

export class SchemaValidationError extends SchemaError {
  readonly schemaName: string;
  readonly version: string;
  readonly issues: readonly import('./types').SchemaValidationIssue[];

  constructor(
    schemaName: string,
    version: string,
    issues: readonly import('./types').SchemaValidationIssue[],
  ) {
    super(
      'SCHEMA_VALIDATION_FAILED',
      `Record does not satisfy schema "${schemaName}@${version}": ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'SchemaValidationError';
    this.schemaName = schemaName;
    this.version = version;
    this.issues = issues;
  }
}
