import { readFileSync } from 'fs';
import { resolve } from 'path';

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version;
    }
  } catch {
    // Fall through to the safe development fallback below.
  }
  return '0.0.0-dev';
}

export const PACKAGE_VERSION = readPackageVersion();
export const MCP_SERVER_NAME = 'pmem-rt';
export const MCP_SCHEMA_VERSION = PACKAGE_VERSION;
