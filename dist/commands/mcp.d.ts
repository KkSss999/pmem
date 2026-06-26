/**
 * Start a read-only stdio MCP server for agent tool integration.
 *
 * IMPORTANT: This command MUST NOT output any console.log — stdout is the
 * MCP protocol transport channel. Any non-JSON output will cause protocol
 * errors. Use stderr for diagnostics if absolutely necessary.
 */
export declare function mcpCommand(writeMode?: 'readonly' | 'append-only'): Promise<void>;
//# sourceMappingURL=mcp.d.ts.map