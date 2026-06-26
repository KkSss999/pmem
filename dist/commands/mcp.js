"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpCommand = mcpCommand;
const path = __importStar(require("path"));
const fs_1 = require("../core/fs");
const security_1 = require("../mcp/security");
const server_1 = require("../mcp/server");
/**
 * Start a read-only stdio MCP server for agent tool integration.
 *
 * IMPORTANT: This command MUST NOT output any console.log — stdout is the
 * MCP protocol transport channel. Any non-JSON output will cause protocol
 * errors. Use stderr for diagnostics if absolutely necessary.
 */
async function mcpCommand(writeMode = 'readonly') {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, '.pmem');
    if (!(0, fs_1.fileExists)(pmemPath)) {
        process.stderr.write('Error: No .pmem directory found. Run `pmem init` first.\n');
        process.exit(2);
    }
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        process.stderr.write('Error: No .pmem/pmem.db found. Run `pmem rebuild` first.\n');
        process.exit(2);
    }
    // Security: validate path scope before starting
    (0, security_1.validatePathScope)(pmemPath);
    await (0, server_1.startMcpServer)(pmemPath, writeMode);
}
//# sourceMappingURL=mcp.js.map