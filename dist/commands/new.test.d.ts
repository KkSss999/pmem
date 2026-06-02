/**
 * v0.7.0 Phase 1: Focused CLI tests for `pmem new` behavior.
 *
 * NOTE: This CLI test runs against the compiled CLI in dist/index.js.
 * It depends on `npm run build` having run. If running tests locally,
 * run `npm run build` first or use `npm test` which automatically triggers
 * the `pretest` build hook.
 *
 * Covers:
 * - Old project (no schema): rejects project/assumption/resource/integration (exit 2)
 * - Old project: accepts module (exit 0, writes to modules/)
 * - Custom schema: accepts character (exit 0, writes to characters/)
 *
 * Uses child_process.execSync to run the real CLI, avoiding process.exit(2)
 * killing the test runner (the error is caught and its status code inspected).
 */
export {};
//# sourceMappingURL=new.test.d.ts.map