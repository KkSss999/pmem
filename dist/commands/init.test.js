"use strict";
/**
 * v0.7.0 Phase 2: Focused CLI tests for `pmem init` domain presets behavior.
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const yaml = __importStar(require("js-yaml"));
const PMEM_BIN = path.resolve(__dirname, '../../dist/index.js');
const TEMP_ROOT = path.join(os.tmpdir(), `pmem-init-test-${Date.now()}`);
function pmem(args, cwd) {
    try {
        const stdout = (0, node_child_process_1.execSync)(`node "${PMEM_BIN}" ${args}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 15_000,
        });
        return { stdout, stderr: '', code: 0 };
    }
    catch (err) {
        return {
            stdout: err.stdout?.toString() ?? '',
            stderr: err.stderr?.toString() ?? '',
            code: err.status ?? 2,
        };
    }
}
(0, node_test_1.describe)('pmem init domain presets', () => {
    (0, node_test_1.before)(() => {
        fs.mkdirSync(TEMP_ROOT, { recursive: true });
    });
    (0, node_test_1.after)(() => {
        try {
            fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
        }
        catch { }
    });
    (0, node_test_1.it)('default pmem init is software domain (non-interactive)', () => {
        const testDir = path.join(TEMP_ROOT, 'init-default');
        fs.mkdirSync(testDir, { recursive: true });
        // Non-interactive guided init to populate fields
        const r = pmem('init my-software --guided --description "software desc" --stage "MVP" --next "Build core"', testDir);
        node_assert_1.default.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);
        const pmemDir = path.join(testDir, '.pmem');
        node_assert_1.default.ok(fs.existsSync(pmemDir), '.pmem should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'modules')), 'modules directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'features')), 'features directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'tasks')), 'tasks directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');
        // Parse manifest.yml
        const manifestPath = path.join(pmemDir, 'manifest.yml');
        node_assert_1.default.ok(fs.existsSync(manifestPath), 'manifest.yml should exist');
        const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
        node_assert_1.default.strictEqual(manifest.project.domain, 'software');
        node_assert_1.default.deepStrictEqual(manifest.schema.card_types, [
            'project', 'module', 'feature', 'task', 'decision',
            'trace', 'risk', 'assumption', 'resource', 'integration'
        ]);
        node_assert_1.default.strictEqual(manifest.schema.default_type, 'trace');
        node_assert_1.default.deepStrictEqual(manifest.schema.foundational_types, ['module']);
        node_assert_1.default.deepStrictEqual(manifest.source_of_truth.card_globs, [
            '.pmem/modules/**/*.md',
            '.pmem/features/**/*.md',
            '.pmem/decisions/**/*.md',
            '.pmem/tasks/**/*.md',
            '.pmem/traces/**/*.md',
            '.pmem/risks/**/*.md'
        ]);
        // Test pmem new validation
        const rNew = pmem('new module "Auth"', testDir);
        node_assert_1.default.strictEqual(rNew.code, 0, `new module should succeed, got output: ${rNew.stdout}\n${rNew.stderr}`);
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'modules')), 'modules dir should contain the new card');
        const newFiles = fs.readdirSync(path.join(pmemDir, 'modules'));
        node_assert_1.default.ok(newFiles.some(f => f.startsWith('module.auth_')), 'should write card to modules');
        // Ensure directory is in card_globs
        const hasGlob = manifest.source_of_truth.card_globs.some((g) => g.includes('modules'));
        node_assert_1.default.ok(hasGlob, 'modules directory must be covered by card_globs');
        // software domain rejects project/assumption/resource/integration/character
        for (const badType of ['project', 'assumption', 'resource', 'integration', 'character']) {
            const rBadNew = pmem(`new ${badType} "Test"`, testDir);
            node_assert_1.default.strictEqual(rBadNew.code, 2, `${badType} should be rejected on software domain`);
            node_assert_1.default.ok(rBadNew.stdout.includes(`Invalid card type "${badType}"`));
        }
    });
    (0, node_test_1.it)('init --domain novel creates novel directory structure and writes schema metadata', () => {
        const testDir = path.join(TEMP_ROOT, 'init-novel');
        fs.mkdirSync(testDir, { recursive: true });
        const r = pmem('init my-novel --domain novel --guided --description "novel desc" --stage "Outline" --next "Chapter 1"', testDir);
        node_assert_1.default.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);
        const pmemDir = path.join(testDir, '.pmem');
        node_assert_1.default.ok(fs.existsSync(pmemDir), '.pmem should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'characters')), 'characters directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'chapters')), 'chapters directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'world')), 'world directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'arc')), 'arc directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');
        // Parse manifest.yml
        const manifestPath = path.join(pmemDir, 'manifest.yml');
        const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
        node_assert_1.default.strictEqual(manifest.project.domain, 'novel');
        node_assert_1.default.deepStrictEqual(manifest.schema.card_types, [
            'project', 'character', 'chapter', 'world', 'arc', 'decision', 'trace'
        ]);
        node_assert_1.default.deepStrictEqual(manifest.schema.foundational_types, ['character', 'chapter']);
        node_assert_1.default.deepStrictEqual(manifest.source_of_truth.card_globs, [
            '.pmem/characters/**/*.md',
            '.pmem/chapters/**/*.md',
            '.pmem/world/**/*.md',
            '.pmem/arc/**/*.md',
            '.pmem/decisions/**/*.md',
            '.pmem/traces/**/*.md'
        ]);
        // Test that all creatable types under novel domain succeed and directories are in card_globs
        for (const validType of ['character', 'chapter', 'world', 'arc']) {
            const rNew = pmem(`new ${validType} "My ${validType}"`, testDir);
            node_assert_1.default.strictEqual(rNew.code, 0, `new ${validType} should succeed`);
            const typeDir = manifest.schema.type_dirs[validType];
            node_assert_1.default.ok(typeDir, `should have type_dir for ${validType}`);
            node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, typeDir)), `${typeDir} dir should exist`);
            // Confirm the file is in card_globs coverage
            const globPath = `.pmem/${typeDir}/**/*.md`;
            node_assert_1.default.ok(manifest.source_of_truth.card_globs.includes(globPath), `${globPath} should be in card_globs`);
        }
        // novel domain rejects project
        const rBadNew = pmem('new project "My Project"', testDir);
        node_assert_1.default.strictEqual(rBadNew.code, 2, 'project should be rejected on novel domain');
    });
    (0, node_test_1.it)('init --domain research creates research directory structure', () => {
        const testDir = path.join(TEMP_ROOT, 'init-research');
        fs.mkdirSync(testDir, { recursive: true });
        const r = pmem('init my-research --domain research --guided --description "research desc" --stage "Initial research" --next "Literature review"', testDir);
        node_assert_1.default.strictEqual(r.code, 0, `init failed: ${r.stdout}\n${r.stderr}`);
        const pmemDir = path.join(testDir, '.pmem');
        node_assert_1.default.ok(fs.existsSync(pmemDir), '.pmem should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'sources')), 'sources directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'claims')), 'claims directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'notes')), 'notes directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'experiments')), 'experiments directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'decisions')), 'decisions directory should exist');
        node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, 'traces')), 'traces directory should exist');
        // Parse manifest.yml
        const manifestPath = path.join(pmemDir, 'manifest.yml');
        const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
        node_assert_1.default.strictEqual(manifest.project.domain, 'research');
        node_assert_1.default.deepStrictEqual(manifest.schema.card_types, [
            'project', 'source', 'claim', 'note', 'experiment', 'decision', 'trace'
        ]);
        node_assert_1.default.deepStrictEqual(manifest.schema.foundational_types, ['source', 'claim']);
        node_assert_1.default.deepStrictEqual(manifest.source_of_truth.card_globs, [
            '.pmem/sources/**/*.md',
            '.pmem/claims/**/*.md',
            '.pmem/notes/**/*.md',
            '.pmem/experiments/**/*.md',
            '.pmem/decisions/**/*.md',
            '.pmem/traces/**/*.md'
        ]);
        // Test that all creatable types under research domain succeed and directories are in card_globs
        for (const validType of ['source', 'claim', 'note', 'experiment']) {
            const rNew = pmem(`new ${validType} "My ${validType}"`, testDir);
            node_assert_1.default.strictEqual(rNew.code, 0, `new ${validType} should succeed`);
            const typeDir = manifest.schema.type_dirs[validType];
            node_assert_1.default.ok(typeDir, `should have type_dir for ${validType}`);
            node_assert_1.default.ok(fs.existsSync(path.join(pmemDir, typeDir)), `${typeDir} dir should exist`);
            // Confirm the file is in card_globs coverage
            const globPath = `.pmem/${typeDir}/**/*.md`;
            node_assert_1.default.ok(manifest.source_of_truth.card_globs.includes(globPath), `${globPath} should be in card_globs`);
        }
        // research domain rejects project
        const rBadNew = pmem('new project "My Project"', testDir);
        node_assert_1.default.strictEqual(rBadNew.code, 2, 'project should be rejected on research domain');
    });
    (0, node_test_1.it)('fresh init output templates contain correct exits 0 update --suggest semantics', () => {
        const testDir = path.join(TEMP_ROOT, 'init-templates-check');
        fs.mkdirSync(testDir, { recursive: true });
        const r = pmem('init templates-check --guided --description "desc" --stage "stage" --next "next"', testDir);
        node_assert_1.default.strictEqual(r.code, 0);
        const checkNoExit1 = (filePath) => {
            const content = fs.readFileSync(filePath, 'utf8');
            const lower = content.toLowerCase();
            node_assert_1.default.ok(!lower.includes('exit code 1'), `File ${filePath} should not contain 'exit code 1'`);
            node_assert_1.default.ok(!lower.includes('exits with code 1'), `File ${filePath} should not contain 'exits with code 1'`);
            node_assert_1.default.ok(!lower.includes('exits 1'), `File ${filePath} should not contain 'exits 1'`);
            node_assert_1.default.ok(lower.includes('exits 0'), `File ${filePath} should contain 'exits 0'`);
        };
        checkNoExit1(path.join(testDir, 'AGENTS.md'));
        checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'claude-code', 'CLAUDE.md'));
        checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'cursor', 'rules.example.md'));
        checkNoExit1(path.join(testDir, '.pmem', 'integrations', 'codex', 'AGENTS.md'));
    });
    (0, node_test_1.it)('rejects unknown domain preset with exit 2', () => {
        const testDir = path.join(TEMP_ROOT, 'init-unknown');
        fs.mkdirSync(testDir, { recursive: true });
        const r = pmem('init my-project --domain sci-fi --guided --description "scifi desc" --stage "Initial" --next "Plan"', testDir);
        node_assert_1.default.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
        node_assert_1.default.ok(r.stderr.includes('Invalid domain "sci-fi"'), `stderr should contain invalid domain warning: ${r.stderr}`);
        node_assert_1.default.ok(r.stderr.includes('Valid domains are: software, novel, research'), `stderr should show valid options: ${r.stderr}`);
    });
});
//# sourceMappingURL=init.test.js.map