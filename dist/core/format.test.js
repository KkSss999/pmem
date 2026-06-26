"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const format_1 = require("./format");
// Minimal RecallQueryResult shape sufficient to exercise formatRecallCompact
function makeRecallResult(overrides = {}) {
    return {
        project: 'test-project',
        project_stage: 'Development',
        focus: 'Testing recall output',
        recent_traces: [],
        architecture: [],
        decisions: [],
        ...overrides,
    };
}
(0, node_test_1.describe)('formatRecallCompact — RECENT CHANGES', () => {
    (0, node_test_1.it)('shows thick trace what_changed items when present', () => {
        const result = makeRecallResult({
            recent_traces: [
                {
                    id: 'trace-001',
                    title: 'Fix score logic',
                    summary: 'Session summary only',
                    file_path: '.pmem/traces/2025-01-01-001.md',
                    created_at: '2025-01-01T00:00:00Z',
                    changed_files: ['src/App.jsx'],
                    what_changed: [
                        'Modified src/App.jsx — added: calcScore, removed: computeScore',
                        'Modified src/utils.ts — added: helpers',
                    ],
                    decisions: [],
                    architecture_notes: [],
                    next: [],
                },
            ],
        });
        const output = (0, format_1.formatOutput)(result, 'compact');
        node_assert_1.default.ok(output.includes('Modified src/App.jsx'), `Expected "Modified src/App.jsx" in RECENT CHANGES, got:\n${output}`);
        node_assert_1.default.ok(output.includes('added: calcScore'), `Expected symbol detail "added: calcScore" in output, got:\n${output}`);
        node_assert_1.default.ok(output.includes('Modified src/utils.ts'), `Expected "Modified src/utils.ts" in output, got:\n${output}`);
        // The session-level summary should NOT crowd out the thick trace details
        node_assert_1.default.ok(!output.includes('Session summary only'), `Expected thick trace to suppress session summary fallback, got:\n${output}`);
    });
    (0, node_test_1.it)('falls back to summary when what_changed is empty', () => {
        const result = makeRecallResult({
            recent_traces: [
                {
                    id: 'trace-002',
                    title: 'Minor cleanup',
                    summary: 'Cleaned up imports',
                    file_path: '.pmem/traces/2025-01-02-001.md',
                    created_at: '2025-01-02T00:00:00Z',
                    changed_files: [],
                    what_changed: [], // empty — should fall back to summary
                    decisions: [],
                    architecture_notes: [],
                    next: [],
                },
            ],
        });
        const output = (0, format_1.formatOutput)(result, 'compact');
        node_assert_1.default.ok(output.includes('Cleaned up imports'), `Expected summary fallback "Cleaned up imports" in output, got:\n${output}`);
    });
    (0, node_test_1.it)('deduplicates identical what_changed items across multiple traces', () => {
        const sharedItem = 'Modified src/shared.ts — added: util';
        const result = makeRecallResult({
            recent_traces: [
                {
                    id: 'trace-003', title: 'A', summary: 'S',
                    file_path: '.pmem/traces/a.md', created_at: '',
                    changed_files: [], what_changed: [sharedItem],
                    decisions: [], architecture_notes: [], next: [],
                },
                {
                    id: 'trace-004', title: 'B', summary: 'S',
                    file_path: '.pmem/traces/b.md', created_at: '',
                    changed_files: [], what_changed: [sharedItem],
                    decisions: [], architecture_notes: [], next: [],
                },
            ],
        });
        const output = (0, format_1.formatOutput)(result, 'compact');
        const count = (output.match(/Modified src\/shared\.ts/g) || []).length;
        node_assert_1.default.strictEqual(count, 1, `Duplicate item should appear only once, found ${count} times in:\n${output}`);
    });
});
//# sourceMappingURL=format.test.js.map