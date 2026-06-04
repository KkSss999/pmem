"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fs_1 = require("./fs");
(0, node_test_1.default)('isPathMatch matches exact file paths', () => {
    strict_1.default.equal((0, fs_1.isPathMatch)('src/index.ts', 'src/index.ts'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/index.ts', 'src/commands.ts'), false);
    strict_1.default.equal((0, fs_1.isPathMatch)('v064/.pmem/index.md', '.pmem/index.md'), false);
});
(0, node_test_1.default)('isPathMatch matches files inside target directories', () => {
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/status.ts', 'src/commands'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/status.ts', 'src/commands/'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/status.ts', 'src'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/status.ts', 'src/comm'), false);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands-extra/status.ts', 'src/commands'), false);
});
(0, node_test_1.default)('isPathMatch handles trailing slashes correctly', () => {
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/', 'src/commands'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands', 'src/commands/'), true);
    strict_1.default.equal((0, fs_1.isPathMatch)('src/commands/', 'src/commands/'), true);
});
//# sourceMappingURL=fs.test.js.map