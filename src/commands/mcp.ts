import * as path from 'path';
import { fileExists } from '../core/fs';
import { validatePathScope } from '../mcp/security';
import { startMcpServer } from '../mcp/server';
import { Pmem } from '../runtime';

/**
 * Start a read-only stdio MCP server for agent tool integration.
 *
 * IMPORTANT: This command MUST NOT output any console.log — stdout is the
 * MCP protocol transport channel. Any non-JSON output will cause protocol
 * errors. Use stderr for diagnostics if absolutely necessary.
 */
export async function mcpCommand(writeMode: 'readonly' | 'append-only' = 'readonly'): Promise<void> {
  const cwd = process.cwd();
  const pmemPath = path.join(cwd, '.pmem');

  if (!fileExists(pmemPath)) {
    process.stderr.write('Error: No .pmem directory found. Run `pmem init` first.\n');
    process.exit(2);
  }

  const dbPath = path.join(pmemPath, 'pmem.db');
  if (!fileExists(dbPath)) {
    process.stderr.write('Error: No .pmem/pmem.db found. Run `pmem rebuild` first.\n');
    process.exit(2);
  }

  // Security: validate path scope before starting
  validatePathScope(pmemPath);

  const runtime = await Pmem.open({ root: cwd });
  await startMcpServer(runtime, writeMode);
}

