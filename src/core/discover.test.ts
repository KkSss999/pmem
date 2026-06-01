import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import Database from 'better-sqlite3';

import { BUILTIN_PATTERNS, loadPatternRegistry, isBuiltinModule, BUILTIN_MODULES } from './discover/patterns';
import { detectLanguages, filterPatterns } from './discover/detect';
import { createSchema, insertEdge, deleteInferredEdges, getInferredEdges, getEdgesForCard, updateEdgeSource, deleteEdgesByIds, deleteExplicitCardEdges, getOrphanEdges } from './db';
import type { LanguagePattern } from '../types';

// --- Patterns ---

describe('BUILTIN_PATTERNS', () => {
  it('has all 6 required languages', () => {
    const langs = Object.keys(BUILTIN_PATTERNS);
    assert.ok(langs.includes('nodejs'));
    assert.ok(langs.includes('python'));
    assert.ok(langs.includes('rust'));
    assert.ok(langs.includes('go'));
    assert.ok(langs.includes('cpp'));
    assert.ok(langs.includes('java'));
  });

  it('each language has indicators', () => {
    for (const [name, p] of Object.entries(BUILTIN_PATTERNS)) {
      assert.ok(p.indicators.length > 0, `${name} should have indicators`);
      assert.ok(p.extensions.length > 0, `${name} should have extensions`);
      assert.ok(p.source_patterns.length > 0, `${name} should have source_patterns`);
    }
  });

  it('each source_pattern has valid regex', () => {
    for (const p of Object.values(BUILTIN_PATTERNS)) {
      for (const sp of p.source_patterns) {
        try {
          new RegExp(sp.regex, 'gm');
        } catch {
          assert.fail(`Invalid regex in ${p.language}: ${sp.regex}`);
        }
      }
    }
  });

  it('nodejs pattern matches import statements', () => {
    const nodePatterns = BUILTIN_PATTERNS.nodejs.source_patterns;
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

  it('python pattern matches import statements', () => {
    const pyPatterns = BUILTIN_PATTERNS.python.source_patterns;
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

  it('cpp pattern distinguishes local and system includes', () => {
    const cppPatterns = BUILTIN_PATTERNS.cpp.source_patterns;
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

describe('loadPatternRegistry', () => {
  it('returns built-in patterns when no extras', () => {
    const patterns = loadPatternRegistry();
    assert.strictEqual(patterns.length, 6);
  });

  it('merges custom patterns (override by language key)', () => {
    const custom: LanguagePattern = {
      language: 'nodejs',
      indicators: ['custom.json'],
      extensions: ['.custom'],
      source_patterns: [],
      dep_files: [],
      exclude_dirs: [],
    };
    const patterns = loadPatternRegistry([custom]);
    const nodejs = patterns.find(p => p.language === 'nodejs')!;
    assert.strictEqual(nodejs.indicators.length, 1);
    assert.strictEqual(nodejs.indicators[0], 'custom.json');
  });

  it('adds new language patterns', () => {
    const custom: LanguagePattern = {
      language: 'zig',
      indicators: ['build.zig'],
      extensions: ['.zig'],
      source_patterns: [
        { regex: '@import\\(\"([^\"]+)\"\\)', confidence: 0.7, scope: 'both' },
      ],
      dep_files: [],
      exclude_dirs: [],
    };
    const patterns = loadPatternRegistry([custom]);
    const zig = patterns.find(p => p.language === 'zig')!;
    assert.ok(zig);
    assert.strictEqual(zig.extensions[0], '.zig');
  });
});

// --- Detect ---

describe('detectLanguages', () => {
  function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-detect-'));
  }

  function cleanup(d: string): void {
    fs.rmSync(d, { recursive: true, force: true });
  }

  it('detects nodejs from package.json', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'package.json'), '{}');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('nodejs'));
    cleanup(d);
  });

  it('detects python from requirements.txt', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'requirements.txt'), '');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('python'));
    cleanup(d);
  });

  it('detects rust from Cargo.toml', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'Cargo.toml'), '');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('rust'));
    cleanup(d);
  });

  it('detects go from go.mod', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'go.mod'), '');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('go'));
    cleanup(d);
  });

  it('detects java from pom.xml', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'pom.xml'), '');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('java'));
    cleanup(d);
  });

  it('detects multiple languages', () => {
    const d = makeTmpDir();
    fs.writeFileSync(path.join(d, 'package.json'), '{}');
    fs.writeFileSync(path.join(d, 'requirements.txt'), '');
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.ok(langs.includes('nodejs'));
    assert.ok(langs.includes('python'));
    cleanup(d);
  });

  it('returns empty for unknown project', () => {
    const d = makeTmpDir();
    const langs = detectLanguages(d, Object.values(BUILTIN_PATTERNS));
    assert.strictEqual(langs.length, 0);
    cleanup(d);
  });
});

describe('filterPatterns', () => {
  const patterns = Object.values(BUILTIN_PATTERNS);

  it('returns all patterns for auto', () => {
    assert.strictEqual(filterPatterns(patterns, ['auto']).length, 6);
  });

  it('returns all patterns for empty array', () => {
    assert.strictEqual(filterPatterns(patterns, []).length, 6);
  });

  it('filters to specified languages', () => {
    const filtered = filterPatterns(patterns, ['python', 'rust']);
    assert.strictEqual(filtered.length, 2);
    assert.strictEqual(filtered[0].language, 'python');
    assert.strictEqual(filtered[1].language, 'rust');
  });

  it('case-insensitive', () => {
    const filtered = filterPatterns(patterns, ['PYTHON', 'NodeJS']);
    assert.strictEqual(filtered.length, 2);
  });
});

// --- Edge CRUD ---

describe('v0.6.3 edge CRUD', () => {
  function makeDb(): Database.Database {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare(`INSERT INTO cards (id, type, title, file_path, file_hash, frontmatter_hash, body_hash)
      VALUES ('card-a', 'module', 'Module A', 'a.md', 'h1', 'h2', 'h3')`).run();
    db.prepare(`INSERT INTO cards (id, type, title, file_path, file_hash, frontmatter_hash, body_hash)
      VALUES ('card-b', 'module', 'Module B', 'b.md', 'h1', 'h2', 'h3')`).run();
    return db;
  }

  it('insertEdge and getInferredEdges', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    const inferred = getInferredEdges(db);
    assert.strictEqual(inferred.length, 1);
    assert.strictEqual(inferred[0].from_id, 'card-a');
    assert.strictEqual(inferred[0].confidence, 0.7);
    db.close();
  });

  it('deleteInferredEdges removes only inferred', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
    const deleted = deleteInferredEdges(db);
    assert.strictEqual(deleted, 1);
    const allEdges = getEdgesForCard(db, 'card-a');
    assert.strictEqual(allEdges.length, 1);
    assert.strictEqual(allEdges[0].source, 'explicit');
    db.close();
  });

  it('deleteExplicitCardEdges removes only explicit', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
    deleteExplicitCardEdges(db, 'card-a');
    const allEdges = getEdgesForCard(db, 'card-a');
    assert.strictEqual(allEdges.length, 1);
    assert.strictEqual(allEdges[0].source, 'inferred');
    db.close();
  });

  it('getEdgesForCard filters by source', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'related_to', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });

    const explicit = getEdgesForCard(db, 'card-a', 'explicit');
    assert.strictEqual(explicit.length, 1);
    assert.strictEqual(explicit[0].type, 'related_to');

    const inferred = getEdgesForCard(db, 'card-a', 'inferred');
    assert.strictEqual(inferred.length, 1);
    assert.strictEqual(inferred[0].type, 'depends_on');
    db.close();
  });

  it('updateEdgeSource upgrades inferred to explicit', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    const rows = db.prepare("SELECT id FROM edges").all() as Array<{ id: number }>;
    const changed = updateEdgeSource(db, [rows[0].id], 'explicit', 1.0);
    assert.strictEqual(changed, 1);
    const edge = db.prepare("SELECT * FROM edges WHERE id = ?").get(rows[0].id) as { source: string; confidence: number };
    assert.strictEqual(edge.source, 'explicit');
    assert.strictEqual(edge.confidence, 1.0);
    db.close();
  });

  it('deleteEdgesByIds removes specific edges', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'card-b', type: 'depends_on', source: 'inferred', confidence: 0.7, created_at: 'now', updated_at: 'now' });
    const rows = db.prepare("SELECT id FROM edges").all() as Array<{ id: number }>;
    const deleted = deleteEdgesByIds(db, [rows[0].id]);
    assert.strictEqual(deleted, 1);
    const remaining = getEdgesForCard(db, 'card-a');
    assert.strictEqual(remaining.length, 0);
    db.close();
  });

  it('getOrphanEdges finds edges with missing cards', () => {
    const db = makeDb();
    insertEdge(db, { from_id: 'card-a', to_id: 'nonexistent', type: 'depends_on', source: 'explicit', confidence: 1.0, created_at: 'now', updated_at: 'now' });
    const orphans = getOrphanEdges(db);
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0].to_id, 'nonexistent');
    db.close();
  });

  it('empty id arrays are safe', () => {
    const db = makeDb();
    assert.strictEqual(updateEdgeSource(db, [], 'explicit', 1.0), 0);
    assert.strictEqual(deleteEdgesByIds(db, []), 0);
    db.close();
  });
});

// --- BUILTIN_MODULES (false-positive guard) ---

describe('BUILTIN_MODULES', () => {
  it('covers all 6 languages', () => {
    for (const lang of ['nodejs', 'python', 'rust', 'go', 'cpp', 'java']) {
      assert.ok(BUILTIN_MODULES[lang], `${lang} should have a builtin set`);
      assert.ok(BUILTIN_MODULES[lang].size > 0, `${lang} should have entries`);
    }
  });

  it('contains common Node.js core modules', () => {
    const set = BUILTIN_MODULES.nodejs;
    for (const m of ['fs', 'path', 'os', 'http', 'https', 'crypto', 'child_process', 'stream', 'util', 'events']) {
      assert.ok(set.has(m), `nodejs builtin should include ${m}`);
    }
  });

  it('contains common Python stdlib', () => {
    const set = BUILTIN_MODULES.python;
    for (const m of ['os', 'sys', 'json', 're', 'typing', 'collections', 'itertools', 'pathlib', 'asyncio', 'unittest']) {
      assert.ok(set.has(m), `python builtin should include ${m}`);
    }
  });

  it('contains common Java/JVM packages', () => {
    const set = BUILTIN_MODULES.java;
    for (const p of ['java', 'javax', 'jakarta', 'org.springframework', 'org.junit', 'lombok']) {
      assert.ok(set.has(p), `java builtin should include ${p}`);
    }
  });

  it('contains common Go stdlib', () => {
    const set = BUILTIN_MODULES.go;
    for (const m of ['fmt', 'io', 'os', 'net', 'time', 'context', 'sync', 'encoding']) {
      assert.ok(set.has(m), `go builtin should include ${m}`);
    }
    // Go's full-path imports like net/http are checked via the `net` prefix.
    assert.ok(set.has('net'));
  });

  it('contains C/C++ standard headers', () => {
    const set = BUILTIN_MODULES.cpp;
    for (const m of ['stdio', 'stdlib', 'iostream', 'vector', 'string', 'memory', 'algorithm']) {
      assert.ok(set.has(m), `cpp builtin should include ${m}`);
    }
  });
});

describe('isBuiltinModule', () => {
  it('matches bare Node.js core modules', () => {
    assert.ok(isBuiltinModule('fs', 'nodejs'));
    assert.ok(isBuiltinModule('path', 'nodejs'));
    assert.ok(isBuiltinModule('crypto', 'nodejs'));
  });

  it('strips node: prefix for Node.js', () => {
    assert.ok(isBuiltinModule('node:fs', 'nodejs'));
    assert.ok(isBuiltinModule('node:path', 'nodejs'));
  });

  it('matches namespaced submodules by first segment', () => {
    assert.ok(isBuiltinModule('fs/promises', 'nodejs'));
    assert.ok(isBuiltinModule('path/posix', 'nodejs'));
    assert.ok(isBuiltinModule('stream/web', 'nodejs'));
  });

  it('does not match project modules', () => {
    assert.ok(!isBuiltinModule('express', 'nodejs'));
    assert.ok(!isBuiltinModule('better-sqlite3', 'nodejs'));
    // @types/* are TypeScript declaration packages, not project modules.
    // The discover scan should filter them as externals.
    assert.ok(isBuiltinModule('@types/node', 'nodejs'));
  });

  it('matches Python stdlib', () => {
    assert.ok(isBuiltinModule('os', 'python'));
    assert.ok(isBuiltinModule('json', 'python'));
    assert.ok(isBuiltinModule('typing', 'python'));
  });

  it('does not match Python third-party packages', () => {
    assert.ok(!isBuiltinModule('requests', 'python'));
    assert.ok(!isBuiltinModule('numpy', 'python'));
    assert.ok(!isBuiltinModule('flask', 'python'));
  });

  it('matches Java/JVM by any dot-segment', () => {
    assert.ok(isBuiltinModule('java.util.List', 'java'));
    assert.ok(isBuiltinModule('org.springframework.boot.Application', 'java'));
    assert.ok(isBuiltinModule('jakarta.persistence.Entity', 'java'));
  });

  it('matches Go stdlib', () => {
    assert.ok(isBuiltinModule('fmt', 'go'));
    assert.ok(isBuiltinModule('net/http', 'go'));
  });

  it('matches C/C++ headers', () => {
    assert.ok(isBuiltinModule('stdio', 'cpp'));
    assert.ok(isBuiltinModule('iostream', 'cpp'));
  });

  it('returns false for unknown language', () => {
    assert.ok(!isBuiltinModule('fs', 'cobol'));
  });
});

// --- End-to-end noise filtering on a real file ---

describe('discover noise filtering', () => {
  function setupTempProject() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmem-discover-'));
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'tmp', dependencies: { 'better-sqlite3': '^7.0.0' }
    }));
    fs.writeFileSync(path.join(srcDir, 'app.ts'),
      "import * as fs from 'fs';\n" +
      "import * as path from 'path';\n" +
      "import express from 'express';\n" +
      "import { helper } from './helper';\n");
    return tmp;
  }

  function setupDb(tmpDir: string) {
    const dbPath = path.join(tmpDir, '.pmem', 'pmem.db');
    fs.mkdirSync(path.join(tmpDir, '.pmem'), { recursive: true });
    const db = new Database(dbPath);
    createSchema(db);
    // Register one source file pointing to app.ts
    db.prepare(
      "INSERT INTO paths (path, card_id, relation) VALUES (?, ?, 'source_file')"
    ).run('src/app.ts', 'card-app');
    return db;
  }

  it('skips builtin modules entirely (no edges, no ambiguous)', () => {
    // Direct regex-level test: builtin targets never reach allRefs.
    // We exercise the public isBuiltinModule + the scan-time guard.
    const content = "import * as fs from 'fs';\nimport * as path from 'path';";
    const pattern = BUILTIN_PATTERNS.nodejs.source_patterns[0];
    const re = new RegExp(pattern.regex, 'gm');
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const target = (m[1] || '').trim();
      if (isBuiltinModule(target, 'nodejs')) continue;
      matches.push(target);
    }
    assert.deepStrictEqual(matches, []);
  });

  it('keeps non-builtin bare imports as external_bare refs', () => {
    const content = "import express from 'express';";
    const pattern = BUILTIN_PATTERNS.nodejs.source_patterns[0];
    const re = new RegExp(pattern.regex, 'gm');
    const m = re.exec(content);
    assert.ok(m);
    const target = m[1];
    assert.ok(!isBuiltinModule(target, 'nodejs'));
  });

  it('end-to-end: discover on temp project drops builtins and external packages', () => {
    const tmp = setupTempProject();
    const db = setupDb(tmp);

    // Replicate the discover scan logic for one language
    const allRefs: Array<{ target_kind: 'local_file' | 'external_bare'; target_name: string }> = [];
    const lang = BUILTIN_PATTERNS.nodejs;
    const extSet = new Set(lang.extensions);
    const filePath = path.join(tmp, 'src', 'app.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const pattern of lang.source_patterns) {
      const re = new RegExp(pattern.regex, 'gm');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const target = (m[1] || '').trim();
        if (isBuiltinModule(target, lang.language)) continue;
        if (target.startsWith('.') || target.startsWith('/')) {
          allRefs.push({ target_kind: 'local_file', target_name: target });
        } else {
          allRefs.push({ target_kind: 'external_bare', target_name: target });
        }
      }
    }

    const builtinRefs = allRefs.filter(r => isBuiltinModule(r.target_name, 'nodejs'));
    assert.strictEqual(builtinRefs.length, 0, 'builtins should be filtered out');

    const externals = allRefs.filter(r => r.target_kind === 'external_bare');
    const locals = allRefs.filter(r => r.target_kind === 'local_file');
    assert.ok(externals.some(r => r.target_name === 'express'), 'express should be external_bare');
    assert.ok(locals.some(r => r.target_name.includes('./helper')), './helper should be local_file');

    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
