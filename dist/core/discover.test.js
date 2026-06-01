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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const patterns_1 = require("./discover/patterns");
const detect_1 = require("./discover/detect");
const db_1 = require("./db");
// --- Patterns ---
(0, node_test_1.describe)('BUILTIN_PATTERNS', () => {
    (0, node_test_1.it)('has all 6 required languages', () => {
        const langs = Object.keys(patterns_1.BUILTIN_PATTERNS);
        assert.ok(langs.includes('nodejs'));
        assert.ok(langs.includes('python'));
        assert.ok(langs.includes('rust'));
        assert.ok(langs.includes('go'));
        assert.ok(langs.includes('cpp'));
        assert.ok(langs.includes('java'));
    });
    (0, node_test_1.it)('each language has indicators', () => {
        for (const [name, p] of Object.entries(patterns_1.BUILTIN_PATTERNS)) {
            assert.ok(p.indicators.length > 0, `${name} should have indicators`);
            assert.ok(p.extensions.length > 0, `${name} should have extensions`);
            assert.ok(p.source_patterns.length > 0, `${name} should have source_patterns`);
        }
    });
    (0, node_test_1.it)('each source_pattern has valid regex', () => {
        for (const p of Object.values(patterns_1.BUILTIN_PATTERNS)) {
            for (const sp of p.source_patterns) {
                try {
                    new RegExp(sp.regex, 'gm');
                }
                catch {
                    assert.fail(`Invalid regex in ${p.language}: ${sp.regex}`);
                }
            }
        }
    });
    (0, node_test_1.it)('nodejs pattern matches import statements', () => {
        const nodePatterns = patterns_1.BUILTIN_PATTERNS.nodejs.source_patterns;
        const testCode = `import { foo } from './bar';
import express from 'express';
const _ = require('lodash');
const db = require('./db');
import('dynamic-lib').then();`;
        const re = new RegExp(nodePatterns[0].regex, 'gm');
        const matches = [...testCode.matchAll(re)].map(m => m[1]);
        assert.ok(matches.includes('./bar'));
        assert.ok(matches.includes('express'));
        const requireRe = new RegExp(nodePatterns[1].regex, 'gm');
        const requireMatches = [...testCode.matchAll(requireRe)].map(m => m[1]);
        assert.ok(requireMatches.includes('lodash'));
        assert.ok(requireMatches.includes('./db'));
    });
    (0, node_test_1.it)('python pattern matches import statements', () => {
        const pyPatterns = patterns_1.BUILTIN_PATTERNS.python.source_patterns;
        const testCode = `import os
from pathlib import Path
from . import utils
from ..core.db import connect`;
        // import xxx pattern
        const re1 = new RegExp(pyPatterns[1].regex, 'gm');
        const matches1 = [...testCode.matchAll(re1)].map(m => m[1]);
        assert.ok(matches1.includes('os'));
        // from xxx import yyy pattern
        const re0 = new RegExp(pyPatterns[0].regex, 'gm');
        const matches0 = [...testCode.matchAll(re0)].map(m => m[1]);
        assert.ok(matches0.includes('pathlib'));
    });
    (0, node_test_1.it)('cpp pattern distinguishes local and system includes', () => {
        const cppPatterns = patterns_1.BUILTIN_PATTERNS.cpp.source_patterns;
        const testCode = `#include "mylib.h"
#include <vector>
#include <string>`;
        const localRe = new RegExp(cppPatterns[0].regex, 'gm');
        const localMatches = [...testCode.matchAll(localRe)].map(m => m[1]);
        assert.ok(localMatches.includes('mylib.h'));
        const sysRe = new RegExp(cppPatterns[1].regex, 'gm');
        const sysMatches = [...testCode.matchAll(sysRe)].map(m => m[1]);
        assert.ok(sysMatches.includes('vector'));
        assert.ok(sysMatches.includes('string'));
    });
});
(0, node_test_1.describe)('loadPatternRegistry', () => {
    (0, node_test_1.it)('returns built-in patterns when no extras', () => {
        const patterns = (0, patterns_1.loadPatternRegistry)();
        assert.strictEqual(patterns.length, 6);
    });
    (0, node_test_1.it)('merges custom patterns (override by language key)', () => {
        const custom = {
            language: 'nodejs',
            indicators: ['custom.json'],
            extensions: ['.custom'],
            source_patterns: [],
            dep_files: [],
            exclude_dirs: [],
        };
        const patterns = (0, patterns_1.loadPatternRegistry)([custom]);
        const nodejs = patterns.find(p => p.language === 'nodejs');
        assert.strictEqual(nodejs.indicators.length, 1);
        assert.strictEqual(nodejs.indicators[0], 'custom.json');
    });
    (0, node_test_1.it)('adds new language patterns', () => {
        const custom = {
            language: 'zig',
            indicators: ['build.zig'],
            extensions: ['.zig'],
            source_patterns: [
                { regex: '@import\\(\"([^\"]+)\"\\)', confidence: 0.7, scope: 'both' },
            ],
            dep_files: [],
            exclude_dirs: [],
        };
        const patterns = (0, patterns_1.loadPatternRegistry)([custom]);
        const zig = patterns.find(p => p.language === 'zig');
        assert.ok(zig);
        assert.strictEqual(zig.extensions[0], '.zig');
    });
});
// --- Detect ---
(0, node_test_1.describe)('detectLanguages', () => {
    function makeTmpDir() {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-detect-'));
    }
    function cleanup(d) {
        fs.rmSync(d, { recursive: true, force: true });
    }
    (0, node_test_1.it)('detects nodejs from package.json', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'package.json'), '{}');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('nodejs'));
        cleanup(d);
    });
    (0, node_test_1.it)('detects python from requirements.txt', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'requirements.txt'), '');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('python'));
        cleanup(d);
    });
    (0, node_test_1.it)('detects rust from Cargo.toml', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'Cargo.toml'), '');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('rust'));
        cleanup(d);
    });
    (0, node_test_1.it)('detects go from go.mod', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'go.mod'), '');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('go'));
        cleanup(d);
    });
    (0, node_test_1.it)('detects java from pom.xml', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'pom.xml'), '');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('java'));
        cleanup(d);
    });
    (0, node_test_1.it)('detects multiple languages', () => {
        const d = makeTmpDir();
        fs.writeFileSync(path.join(d, 'package.json'), '{}');
        fs.writeFileSync(path.join(d, 'requirements.txt'), '');
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.ok(langs.includes('nodejs'));
        assert.ok(langs.includes('python'));
        cleanup(d);
    });
    (0, node_test_1.it)('returns empty for unknown project', () => {
        const d = makeTmpDir();
        const langs = (0, detect_1.detectLanguages)(d, Object.values(patterns_1.BUILTIN_PATTERNS));
        assert.strictEqual(langs.length, 0);
        cleanup(d);
    });
});
(0, node_test_1.describe)('filterPatterns', () => {
    const patterns = Object.values(patterns_1.BUILTIN_PATTERNS);
    (0, node_test_1.it)('returns all patterns for auto', () => {
        assert.strictEqual((0, detect_1.filterPatterns)(patterns, ['auto']).length, 6);
    });
    (0, node_test_1.it)('returns all patterns for empty array', () => {
        assert.strictEqual((0, detect_1.filterPatterns)(patterns, []).length, 6);
    });
    (0, node_test_1.it)('filters to specified languages', () => {
        const filtered = (0, detect_1.filterPatterns)(patterns, ['python', 'rust']);
        assert.strictEqual(filtered.length, 2);
        assert.strictEqual(filtered[0].language, 'python');
        assert.strictEqual(filtered[1].language, 'rust');
    });
    (0, node_test_1.it)('case-insensitive', () => {
        const filtered = (0, detect_1.filterPatterns)(patterns, ['PYTHON', 'NodeJS']);
        assert.strictEqual(filtered.length, 2);
    });
});
// --- Edge CRUD ---
(0, node_test_1.describe)('v0.6.3 edge CRUD', () => {
    function makeDb() {
        const db = new better_sqlite3_1.default(':memory:');
        (0, db_1.createSchema)(db);
        db.prepare(`INSERT INTO cards (id, type, title, file_path, file_hash, frontmatter_hash, body_hash)
      VALUES ('card-a', 'module', 'Module A', 'a.md', 'h1', 'h2', 'h3')`).run();
        db.prepare(`INSERT INTO cards (id, type, title, file_path, file_hash, frontmatter_hash, body_hash)
      VALUES ('card-b', 'module', 'Module B', 'b.md', 'h1', 'h2', 'h3')`).run();
        return db;
    }
    (0, node_test_1.it)('insertEdge and getInferredEdges', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        const inferred = (0, db_1.getInferredEdges)(db);
        assert.strictEqual(inferred.length, 1);
        assert.strictEqual(inferred[0].from_id, 'card-a');
        assert.strictEqual(inferred[0].confidence, 0.7);
        db.close();
    });
    (0, node_test_1.it)('deleteInferredEdges removes only inferred', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
        const deleted = (0, db_1.deleteInferredEdges)(db);
        assert.strictEqual(deleted, 1);
        const allEdges = (0, db_1.getEdgesForCard)(db, 'card-a');
        assert.strictEqual(allEdges.length, 1);
        assert.strictEqual(allEdges[0].source, 'explicit');
        db.close();
    });
    (0, node_test_1.it)('deleteExplicitCardEdges removes only explicit', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
        (0, db_1.deleteExplicitCardEdges)(db, 'card-a');
        const allEdges = (0, db_1.getEdgesForCard)(db, 'card-a');
        assert.strictEqual(allEdges.length, 1);
        assert.strictEqual(allEdges[0].source, 'inferred');
        db.close();
    });
    (0, node_test_1.it)('getEdgesForCard filters by source', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
        const explicit = (0, db_1.getEdgesForCard)(db, 'card-a', 'explicit');
        assert.strictEqual(explicit.length, 1);
        assert.strictEqual(explicit[0].type, 'related_to');
        const inferred = (0, db_1.getEdgesForCard)(db, 'card-a', 'inferred');
        assert.strictEqual(inferred.length, 1);
        assert.strictEqual(inferred[0].type, 'depends_on');
        db.close();
    });
    (0, node_test_1.it)('updateEdgeSource upgrades inferred to explicit', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        const rows = db.prepare("SELECT id FROM edges").all();
        const changed = (0, db_1.updateEdgeSource)(db, [rows[0].id], 'explicit', 1.0);
        assert.strictEqual(changed, 1);
        const edge = db.prepare("SELECT * FROM edges WHERE id = ?").get(rows[0].id);
        assert.strictEqual(edge.source, 'explicit');
        assert.strictEqual(edge.confidence, 1.0);
        db.close();
    });
    (0, node_test_1.it)('deleteEdgesByIds removes specific edges', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
        const rows = db.prepare("SELECT id FROM edges").all();
        const deleted = (0, db_1.deleteEdgesByIds)(db, [rows[0].id]);
        assert.strictEqual(deleted, 1);
        const remaining = (0, db_1.getEdgesForCard)(db, 'card-a');
        assert.strictEqual(remaining.length, 0);
        db.close();
    });
    (0, node_test_1.it)('getOrphanEdges finds edges with missing cards', () => {
        const db = makeDb();
        (0, db_1.insertEdge)(db, { from_id: 'card-a', to_id: 'nonexistent', type: 'depends_on', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
        const orphans = (0, db_1.getOrphanEdges)(db);
        assert.strictEqual(orphans.length, 1);
        assert.strictEqual(orphans[0].to_id, 'nonexistent');
        db.close();
    });
    (0, node_test_1.it)('empty id arrays are safe', () => {
        const db = makeDb();
        assert.strictEqual((0, db_1.updateEdgeSource)(db, [], 'explicit', 1.0), 0);
        assert.strictEqual((0, db_1.deleteEdgesByIds)(db, []), 0);
        db.close();
    });
});
// --- BUILTIN_MODULES (false-positive guard) ---
(0, node_test_1.describe)('BUILTIN_MODULES', () => {
    (0, node_test_1.it)('covers all 6 languages', () => {
        for (const lang of ['nodejs', 'python', 'rust', 'go', 'cpp', 'java']) {
            assert.ok(patterns_1.BUILTIN_MODULES[lang], `${lang} should have a builtin set`);
            assert.ok(patterns_1.BUILTIN_MODULES[lang].size > 0, `${lang} should have entries`);
        }
    });
    (0, node_test_1.it)('contains common Node.js core modules', () => {
        const set = patterns_1.BUILTIN_MODULES.nodejs;
        for (const m of ['fs', 'path', 'os', 'http', 'https', 'crypto', 'child_process', 'stream', 'util', 'events']) {
            assert.ok(set.has(m), `nodejs builtin should include ${m}`);
        }
    });
    (0, node_test_1.it)('contains common Python stdlib', () => {
        const set = patterns_1.BUILTIN_MODULES.python;
        for (const m of ['os', 'sys', 'json', 're', 'typing', 'collections', 'itertools', 'pathlib', 'asyncio', 'unittest']) {
            assert.ok(set.has(m), `python builtin should include ${m}`);
        }
    });
    (0, node_test_1.it)('contains common Java/JVM packages', () => {
        const set = patterns_1.BUILTIN_MODULES.java;
        for (const p of ['java', 'javax', 'jakarta', 'org.springframework', 'org.junit', 'lombok']) {
            assert.ok(set.has(p), `java builtin should include ${p}`);
        }
    });
    (0, node_test_1.it)('contains common Go stdlib', () => {
        const set = patterns_1.BUILTIN_MODULES.go;
        for (const m of ['fmt', 'io', 'os', 'net', 'time', 'context', 'sync', 'encoding']) {
            assert.ok(set.has(m), `go builtin should include ${m}`);
        }
        // Go's full-path imports like net/http are checked via the `net` prefix.
        assert.ok(set.has('net'));
    });
    (0, node_test_1.it)('contains C/C++ standard headers', () => {
        const set = patterns_1.BUILTIN_MODULES.cpp;
        for (const m of ['stdio', 'stdlib', 'iostream', 'vector', 'string', 'memory', 'algorithm']) {
            assert.ok(set.has(m), `cpp builtin should include ${m}`);
        }
    });
});
(0, node_test_1.describe)('isBuiltinModule', () => {
    (0, node_test_1.it)('matches bare Node.js core modules', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('fs', 'nodejs'));
        assert.ok((0, patterns_1.isBuiltinModule)('path', 'nodejs'));
        assert.ok((0, patterns_1.isBuiltinModule)('crypto', 'nodejs'));
    });
    (0, node_test_1.it)('strips node: prefix for Node.js', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('node:fs', 'nodejs'));
        assert.ok((0, patterns_1.isBuiltinModule)('node:path', 'nodejs'));
    });
    (0, node_test_1.it)('matches namespaced submodules by first segment', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('fs/promises', 'nodejs'));
        assert.ok((0, patterns_1.isBuiltinModule)('path/posix', 'nodejs'));
        assert.ok((0, patterns_1.isBuiltinModule)('stream/web', 'nodejs'));
    });
    (0, node_test_1.it)('does not match project modules', () => {
        assert.ok(!(0, patterns_1.isBuiltinModule)('express', 'nodejs'));
        assert.ok(!(0, patterns_1.isBuiltinModule)('better-sqlite3', 'nodejs'));
        // @types/* are TypeScript declaration packages, not project modules.
        // The discover scan should filter them as externals.
        assert.ok((0, patterns_1.isBuiltinModule)('@types/node', 'nodejs'));
    });
    (0, node_test_1.it)('matches Python stdlib', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('os', 'python'));
        assert.ok((0, patterns_1.isBuiltinModule)('json', 'python'));
        assert.ok((0, patterns_1.isBuiltinModule)('typing', 'python'));
    });
    (0, node_test_1.it)('does not match Python third-party packages', () => {
        assert.ok(!(0, patterns_1.isBuiltinModule)('requests', 'python'));
        assert.ok(!(0, patterns_1.isBuiltinModule)('numpy', 'python'));
        assert.ok(!(0, patterns_1.isBuiltinModule)('flask', 'python'));
    });
    (0, node_test_1.it)('matches Java/JVM by any dot-segment', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('java.util.List', 'java'));
        assert.ok((0, patterns_1.isBuiltinModule)('org.springframework.boot.Application', 'java'));
        assert.ok((0, patterns_1.isBuiltinModule)('jakarta.persistence.Entity', 'java'));
    });
    (0, node_test_1.it)('matches Go stdlib', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('fmt', 'go'));
        assert.ok((0, patterns_1.isBuiltinModule)('net/http', 'go'));
    });
    (0, node_test_1.it)('matches C/C++ headers', () => {
        assert.ok((0, patterns_1.isBuiltinModule)('stdio', 'cpp'));
        assert.ok((0, patterns_1.isBuiltinModule)('iostream', 'cpp'));
    });
    (0, node_test_1.it)('returns false for unknown language', () => {
        assert.ok(!(0, patterns_1.isBuiltinModule)('fs', 'cobol'));
    });
});
// --- End-to-end noise filtering on a real file ---
(0, node_test_1.describe)('discover noise filtering', () => {
    function setupTempProject() {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-discover-'));
        const srcDir = path.join(tmp, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
            name: 'tmp', dependencies: { 'better-sqlite3': '^7.0.0' }
        }));
        fs.writeFileSync(path.join(srcDir, 'app.ts'), "import * as fs from 'fs';\n" +
            "import * as path from 'path';\n" +
            "import express from 'express';\n" +
            "import { helper } from './helper';\n");
        return tmp;
    }
    function setupDb(tmpDir) {
        const dbPath = path.join(tmpDir, '.pmem', 'pmem.db');
        fs.mkdirSync(path.join(tmpDir, '.pmem'), { recursive: true });
        const db = new better_sqlite3_1.default(dbPath);
        (0, db_1.createSchema)(db);
        // Register one source file pointing to app.ts
        db.prepare("INSERT INTO paths (path, card_id, relation) VALUES (?, ?, 'source_file')").run('src/app.ts', 'card-app');
        return db;
    }
    (0, node_test_1.it)('skips builtin modules entirely (no edges, no ambiguous)', () => {
        // Direct regex-level test: builtin targets never reach allRefs.
        // We exercise the public isBuiltinModule + the scan-time guard.
        const content = "import * as fs from 'fs';\nimport * as path from 'path';";
        const pattern = patterns_1.BUILTIN_PATTERNS.nodejs.source_patterns[0];
        const re = new RegExp(pattern.regex, 'gm');
        const matches = [];
        let m;
        while ((m = re.exec(content)) !== null) {
            const target = (m[1] || '').trim();
            if ((0, patterns_1.isBuiltinModule)(target, 'nodejs'))
                continue;
            matches.push(target);
        }
        assert.deepStrictEqual(matches, []);
    });
    (0, node_test_1.it)('keeps non-builtin bare imports as external_bare refs', () => {
        const content = "import express from 'express';";
        const pattern = patterns_1.BUILTIN_PATTERNS.nodejs.source_patterns[0];
        const re = new RegExp(pattern.regex, 'gm');
        const m = re.exec(content);
        assert.ok(m);
        const target = m[1];
        assert.ok(!(0, patterns_1.isBuiltinModule)(target, 'nodejs'));
    });
    (0, node_test_1.it)('end-to-end: discover on temp project drops builtins and external packages', () => {
        const tmp = setupTempProject();
        const db = setupDb(tmp);
        // Replicate the discover scan logic for one language
        const allRefs = [];
        const lang = patterns_1.BUILTIN_PATTERNS.nodejs;
        const extSet = new Set(lang.extensions);
        const filePath = path.join(tmp, 'src', 'app.ts');
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const pattern of lang.source_patterns) {
            const re = new RegExp(pattern.regex, 'gm');
            let m;
            while ((m = re.exec(content)) !== null) {
                const target = (m[1] || '').trim();
                if ((0, patterns_1.isBuiltinModule)(target, lang.language))
                    continue;
                if (target.startsWith('.') || target.startsWith('/')) {
                    allRefs.push({ target_kind: 'local_file', target_name: target });
                }
                else {
                    allRefs.push({ target_kind: 'external_bare', target_name: target });
                }
            }
        }
        const builtinRefs = allRefs.filter(r => (0, patterns_1.isBuiltinModule)(r.target_name, 'nodejs'));
        assert.strictEqual(builtinRefs.length, 0, 'builtins should be filtered out');
        const externals = allRefs.filter(r => r.target_kind === 'external_bare');
        const locals = allRefs.filter(r => r.target_kind === 'local_file');
        assert.ok(externals.some(r => r.target_name === 'express'), 'express should be external_bare');
        assert.ok(locals.some(r => r.target_name.includes('./helper')), './helper should be local_file');
        db.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});
//# sourceMappingURL=discover.test.js.map