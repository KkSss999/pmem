"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const git_1 = require("./git");
(0, node_test_1.default)('parseGitStatusPorcelain preserves paths for modified files with leading status space', () => {
    const changes = (0, git_1.parseGitStatusPorcelain)(' M src/index.ts\n');
    strict_1.default.deepEqual(changes, [
        { status: 'M', path: 'src/index.ts' },
    ]);
});
(0, node_test_1.default)('parseGitStatusPorcelain handles added, untracked, and renamed files', () => {
    const changes = (0, git_1.parseGitStatusPorcelain)([
        'A  src/new.ts',
        '?? README.md',
        'R  src/old.ts -> src/current.ts',
    ].join('\n'));
    strict_1.default.deepEqual(changes, [
        { status: 'A', path: 'src/new.ts' },
        { status: '??', path: 'README.md' },
        { status: 'R', path: 'src/current.ts' },
    ]);
});
//# sourceMappingURL=git.test.js.map