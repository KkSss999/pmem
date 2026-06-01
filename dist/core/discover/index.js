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
exports.discoverCommand = discoverCommand;
const path = __importStar(require("path"));
const fs_1 = require("../fs");
const db_1 = require("../db");
const patterns_1 = require("./patterns");
const detect_1 = require("./detect");
const PMEM_DIR = '.pmem';
/**
 * Main discover command: detect languages, scan files, resolve to cards, produce edges.
 */
function discoverCommand(options) {
    const cwd = process.cwd();
    const pmemPath = path.join(cwd, PMEM_DIR);
    const minConfidence = options.minConfidence ?? 0.5;
    if (!(0, fs_1.fileExists)(pmemPath)) {
        console.log('No .pmem directory found. Run `pmem init` first.');
        process.exit(2);
    }
    const dbPath = path.join(pmemPath, 'pmem.db');
    if (!(0, fs_1.fileExists)(dbPath)) {
        console.log('No SQLite database found. Run `pmem rebuild` first.');
        process.exit(2);
    }
    // 1. Load patterns
    let extraPatterns;
    if (options.patternFile) {
        try {
            const raw = (0, fs_1.readFile)(path.resolve(cwd, options.patternFile));
            if (raw) {
                const parsed = JSON.parse(raw);
                extraPatterns = parsed.languages || parsed;
            }
        }
        catch {
            console.error(`Failed to parse pattern file: ${options.patternFile}`);
            process.exit(2);
        }
    }
    const allPatterns = (0, patterns_1.loadPatternRegistry)(extraPatterns);
    // 2. Detect or filter languages
    let activePatterns;
    if (options.lang && options.lang !== 'auto') {
        const langs = options.lang.split(',').map(l => l.trim().toLowerCase());
        activePatterns = (0, detect_1.filterPatterns)(allPatterns, langs);
    }
    else {
        const detected = (0, detect_1.detectLanguages)(cwd, allPatterns);
        activePatterns = allPatterns.filter(p => detected.includes(p.language));
    }
    if (activePatterns.length === 0) {
        const msg = options.lang
            ? `No matching language patterns found for: ${options.lang}`
            : 'No supported languages detected in this project.';
        if (options.format === 'json') {
            console.log(JSON.stringify({
                project_languages: [],
                discovered_edges: [],
                ambiguous: [],
                summary: { total_discovered: 0, high_confidence: 0, low_confidence: 0, unmatched_refs: 0 },
            }, null, 2));
        }
        else {
            console.log(msg);
        }
        return;
    }
    const db = (0, db_1.openDatabase)(pmemPath);
    (0, db_1.createSchema)(db);
    // 3. Get all registered source files from the paths table
    const sourceFileRows = db.prepare("SELECT DISTINCT path, card_id FROM paths WHERE relation = 'source_file'").all();
    // Build: absolutePath → cardId map; also track scanned files to avoid duplicates
    const fileCardMap = new Map();
    const seenFiles = new Set();
    for (const row of sourceFileRows) {
        const absPath = path.resolve(cwd, row.path);
        if (!seenFiles.has(absPath)) {
            seenFiles.add(absPath);
            fileCardMap.set(absPath, row.card_id);
        }
        // Also index relative path for lookup only
        if (!fileCardMap.has(row.path)) {
            fileCardMap.set(row.path, row.card_id);
        }
    }
    // Also detect languages from source file extensions (not just indicator files)
    if (!options.lang || options.lang === 'auto') {
        const extLangMap = {
            '.ts': 'nodejs', '.tsx': 'nodejs', '.js': 'nodejs', '.jsx': 'nodejs',
            '.py': 'python', '.rs': 'rust', '.go': 'go',
            '.c': 'cpp', '.cpp': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
            '.java': 'java', '.kt': 'java',
        };
        const extDetected = new Set(activePatterns.map(p => p.language));
        for (const absPath of seenFiles) {
            const ext = path.extname(absPath).toLowerCase();
            const lang = extLangMap[ext];
            if (lang)
                extDetected.add(lang);
        }
        // Filter active patterns to include extension-detected languages
        activePatterns = allPatterns.filter(p => extDetected.has(p.language));
    }
    // 4. Scan for references
    const allRefs = [];
    for (const langPattern of activePatterns) {
        // 4a. Scan source files registered in DB (only those matching language extensions)
        const extSet = new Set(langPattern.extensions);
        const scannedFiles = new Set();
        for (const [filePath, cardId] of fileCardMap) {
            const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
            const ext = path.extname(absPath).toLowerCase();
            if (!extSet.has(ext))
                continue;
            if (!(0, fs_1.fileExists)(absPath))
                continue;
            if (scannedFiles.has(absPath))
                continue;
            scannedFiles.add(absPath);
            const content = (0, fs_1.readFile)(absPath);
            if (!content)
                continue;
            for (const pattern of langPattern.source_patterns) {
                if (pattern.confidence < minConfidence)
                    continue;
                try {
                    const re = new RegExp(pattern.regex, 'gm');
                    let match;
                    while ((match = re.exec(content)) !== null) {
                        const target = match[1] || match[2] || match[3];
                        if (!target)
                            continue;
                        const cleanTarget = target.trim();
                        // Skip language builtins / stdlib (e.g. `fs`, `path`, `os`) entirely.
                        // They are never project-internal references and would only create noise.
                        if ((0, patterns_1.isBuiltinModule)(cleanTarget, langPattern.language))
                            continue;
                        if (pattern.scope !== 'external' && (cleanTarget.startsWith('.') || cleanTarget.startsWith('/'))) {
                            // Local import: try to resolve as file path
                            const resolvedFile = resolveImportPath(absPath, cleanTarget, langPattern.extensions);
                            allRefs.push({
                                from_file: absPath,
                                from_card_id: cardId,
                                target_name: resolvedFile || cleanTarget,
                                language: langPattern.language,
                                strategy: 'source_import',
                                confidence: pattern.confidence,
                                matched_pattern: match[0].trim().substring(0, 80),
                                target_kind: 'local_file',
                            });
                        }
                        else if (pattern.scope !== 'local') {
                            allRefs.push({
                                from_file: absPath,
                                from_card_id: cardId,
                                target_name: cleanTarget,
                                language: langPattern.language,
                                strategy: 'source_import',
                                confidence: pattern.confidence,
                                matched_pattern: match[0].trim().substring(0, 80),
                                target_kind: 'external_bare',
                            });
                        }
                    }
                }
                catch {
                    // skip invalid regex
                }
            }
        }
        // 4b. Scan dependency files
        for (const depFile of langPattern.dep_files) {
            if (depFile.confidence < minConfidence)
                continue;
            const depPath = path.join(cwd, depFile.filename);
            if (!(0, fs_1.fileExists)(depPath))
                continue;
            const content = (0, fs_1.readFile)(depPath);
            if (!content)
                continue;
            const deps = extractDeps(content, depFile);
            // Find which card owns this dep file
            const ownerCardId = fileCardMap.get(depPath);
            for (const dep of deps) {
                // Skip stdlib / well-known framework packages (e.g. @types/*).
                // Bare dep names won't match project cards, and treating them as
                // "unmatched" would only pollute the ambiguous list.
                if ((0, patterns_1.isBuiltinModule)(dep, langPattern.language))
                    continue;
                allRefs.push({
                    from_file: depPath,
                    from_card_id: ownerCardId,
                    target_name: dep,
                    language: langPattern.language,
                    strategy: 'dependency_file',
                    confidence: depFile.confidence,
                    matched_pattern: `${depFile.filename}: ${dep}`,
                    target_kind: 'external_bare',
                });
            }
        }
    }
    // 5. Resolve references to card IDs
    const { edges, ambiguous } = resolveToCards(allRefs, fileCardMap, db, minConfidence);
    // Deduplicate ambiguous entries
    const dedupedAmbiguous = dedupAmbiguous(ambiguous);
    // 6. Output
    const highConf = edges.filter(e => e.confidence >= 0.7).length;
    const lowConf = edges.filter(e => e.confidence < 0.7).length;
    const externalRefs = dedupedAmbiguous.filter(a => a.kind === 'external_unmatched').length;
    const actionable = dedupedAmbiguous.filter(a => a.severity === 'actionable').length;
    const result = {
        project_languages: activePatterns.map(p => p.language),
        discovered_edges: edges,
        ambiguous: dedupedAmbiguous,
        summary: {
            total_discovered: edges.length,
            high_confidence: highConf,
            low_confidence: lowConf,
            unmatched_refs: dedupedAmbiguous.filter(a => a.kind === 'unmatched_target').length,
            external_refs: externalRefs,
            actionable,
        },
    };
    if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        printCompact(result);
    }
    // 7. Write to DB if not dry-run
    if (!options.dryRun) {
        const now = new Date().toISOString();
        const activeSession = (0, db_1.getActiveSession)(db);
        // Remove old inferred edges
        (0, db_1.deleteInferredEdges)(db);
        // Insert new edges
        for (const de of edges) {
            (0, db_1.insertEdge)(db, {
                from_id: de.from_id,
                to_id: de.to_id,
                type: de.type,
                source: 'inferred',
                confidence: de.confidence,
                created_at: now,
                updated_at: now,
            });
        }
        // Mark cards with new inferred edges as dirty
        const dirtyCardIds = new Set(edges.map(e => e.from_id));
        for (const cardId of dirtyCardIds) {
            (0, db_1.insertDirtyFlag)(db, 'card', cardId, 'discover:inferred_edges_added', activeSession?.id);
        }
        (0, db_1.closeDatabase)();
    }
}
/**
 * Resolve collected references to card IDs.
 */
function resolveToCards(refs, fileCardMap, db, minConfidence) {
    const edges = [];
    const ambiguous = [];
    const seenEdges = new Set();
    const now = new Date().toISOString();
    for (const ref of refs) {
        // Try to find target card
        const targetIds = findTargetCards(ref.target_name, fileCardMap, db);
        if (targetIds.length === 0) {
            // Classify: a 'local_file' that didn't resolve is an internal project
            // file with no card — actionable. An 'external_bare' is an external
            // package or full path dep — informational, no action needed.
            const isExternal = ref.target_kind === 'external_bare';
            ambiguous.push({
                kind: isExternal ? 'external_unmatched' : 'unmatched_target',
                severity: isExternal ? 'informational' : 'actionable',
                from_file: ref.from_file,
                from_card_id: ref.from_card_id,
                reference: ref.target_name,
                language: ref.language,
                confidence: ref.confidence,
            });
            continue;
        }
        if (targetIds.length > 1) {
            ambiguous.push({
                kind: 'multiple_targets',
                from_file: ref.from_file,
                from_card_id: ref.from_card_id,
                reference: ref.target_name,
                suggested_targets: targetIds,
                language: ref.language,
                confidence: ref.confidence,
            });
        }
        // Use the best match (first)
        const toId = targetIds[0];
        const fromId = ref.from_card_id;
        if (!fromId)
            continue;
        if (fromId === toId)
            continue; // self-reference
        const edgeKey = `${fromId}→${toId}:${ref.strategy}`;
        if (seenEdges.has(edgeKey))
            continue;
        seenEdges.add(edgeKey);
        if (ref.confidence < minConfidence) {
            ambiguous.push({
                kind: 'low_confidence',
                from_file: ref.from_file,
                from_card_id: fromId,
                reference: `${fromId} → ${toId}`,
                language: ref.language,
                confidence: ref.confidence,
            });
            continue;
        }
        edges.push({
            from_id: fromId,
            to_id: toId,
            type: ref.strategy === 'dependency_file' ? 'depends_on' : 'depends_on',
            source: 'inferred',
            confidence: ref.confidence,
            evidence: {
                language: ref.language,
                strategy: ref.strategy,
                matched_file: ref.from_file,
                matched_pattern: ref.matched_pattern,
            },
        });
    }
    return { edges, ambiguous };
}
/**
 * Find card IDs that match a reference target.
 * Tries: exact path match, filename match, alias match, tag match.
 */
function findTargetCards(target, fileCardMap, db) {
    const results = [];
    // 1. Direct file path match
    if (fileCardMap.has(target)) {
        const cid = fileCardMap.get(target);
        if (!results.includes(cid))
            results.push(cid);
    }
    // 2. Filename-only match — only for file paths (contain / or \) or relative refs,
    //    NOT for bare package names like 'fs', 'path', 'express'
    const looksLikePath = target.includes('/') || target.includes('\\') || target.startsWith('.');
    if (looksLikePath) {
        const targetBasename = path.basename(target).replace(/\.[^.]+$/, '');
        for (const [fpath, cid] of fileCardMap) {
            if (results.includes(cid))
                continue;
            const basename = path.basename(fpath).replace(/\.[^.]+$/, '');
            if (basename === targetBasename) {
                results.push(cid);
            }
        }
    }
    // 3. Card alias match
    try {
        const aliasRows = db.prepare('SELECT card_id FROM aliases WHERE normalized_alias = ?').all(target.toLowerCase().trim());
        for (const row of aliasRows) {
            if (!results.includes(row.card_id)) {
                results.push(row.card_id);
            }
        }
    }
    catch {
        // ignore
    }
    // 4. Card ID substring match
    try {
        const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const cardRows = db.prepare('SELECT id FROM cards WHERE id = ? AND is_deleted = 0').all(normalizedTarget);
        for (const row of cardRows) {
            if (!results.includes(row.id)) {
                results.push(row.id);
            }
        }
    }
    catch {
        // ignore
    }
    return results;
}
/**
 * Resolve a local import path (./xxx or ../xxx) to an absolute file path.
 */
function resolveImportPath(fromFile, importPath, extensions) {
    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);
    // Try exact match first
    if ((0, fs_1.fileExists)(resolved))
        return resolved;
    // Try with extensions
    for (const ext of extensions) {
        const withExt = resolved + ext;
        if ((0, fs_1.fileExists)(withExt))
            return withExt;
    }
    // Try /index.ext
    for (const ext of extensions) {
        const indexFile = path.join(resolved, 'index' + ext);
        if ((0, fs_1.fileExists)(indexFile))
            return indexFile;
    }
    return null;
}
/**
 * Extract dependencies from a dependency file based on parser type.
 */
function extractDeps(content, depFilePattern) {
    const deps = [];
    switch (depFilePattern.parser) {
        case 'json': {
            try {
                const obj = JSON.parse(content);
                const keys = depFilePattern.extractDeps.split(',');
                for (const key of keys) {
                    const section = obj[key.trim()];
                    if (section && typeof section === 'object') {
                        deps.push(...Object.keys(section));
                    }
                }
            }
            catch {
                // invalid JSON
            }
            break;
        }
        case 'text': {
            const extractKey = depFilePattern.extractDeps;
            if (extractKey === 'line') {
                // requirements.txt style: each line is "pkg==version" or "pkg>=version"
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-'))
                        continue;
                    const pkgName = trimmed.split(/[=<>~!]/)[0].trim();
                    if (pkgName)
                        deps.push(pkgName);
                }
            }
            else if (extractKey === 'require') {
                // go.mod style: "require (...)" block or "require pkg version"
                const blockMatch = content.match(/require\s*\(([\s\S]*?)\)/);
                if (blockMatch) {
                    for (const line of blockMatch[1].split('\n')) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 1 && parts[0])
                            deps.push(parts[0]);
                    }
                }
                // Single-line require
                const singleRe = /require\s+(\S+)\s+\S+/g;
                let m;
                while ((m = singleRe.exec(content)) !== null) {
                    deps.push(m[1]);
                }
            }
            else if (extractKey === 'target_link_libraries,find_package' || extractKey === 'find_package,target_link_libraries') {
                // CMakeLists.txt style
                const findPkgRe = /find_package\s*\(\s*(\w+)/g;
                let fm;
                while ((fm = findPkgRe.exec(content)) !== null) {
                    deps.push(fm[1]);
                }
                const tllRe = /target_link_libraries\s*\(\s*\w+\s+(?:PUBLIC|PRIVATE|INTERFACE)\s+(\w+)/g;
                let tm;
                while ((tm = tllRe.exec(content)) !== null) {
                    deps.push(tm[1]);
                }
            }
            break;
        }
        case 'toml': {
            const extractKey = depFilePattern.extractDeps;
            // Simple TOML section parser for [dependencies] style
            const sectionNames = extractKey.split(',');
            for (const sectionName of sectionNames) {
                const section = sectionName.trim();
                // Match [section] or [section.sub]
                const sectionRe = new RegExp(`\\[${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*\\n([\\s\\S]*?)(?:\\n\\[|$)`, 'm');
                const m = content.match(sectionRe);
                if (m) {
                    for (const line of m[1].split('\n')) {
                        const kvMatch = line.match(/^\s*(\w[\w.-]*)\s*=/);
                        if (kvMatch) {
                            deps.push(kvMatch[1]);
                        }
                    }
                }
                // Also try: section.sub.key style (e.g. project.dependencies)
                if (section.includes('.')) {
                    // handled by the section match above with simple bracket matching
                }
            }
            break;
        }
        case 'xml': {
            // Extract <dependency> blocks from pom.xml
            const depRe = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g;
            let dm;
            while ((dm = depRe.exec(content)) !== null) {
                deps.push(`${dm[1]}:${dm[2]}`);
            }
            break;
        }
        case 'groovy': {
            // Extract implementation/api lines from build.gradle
            const extractKey = depFilePattern.extractDeps;
            const keys = extractKey.split(',').map(k => k.trim()).join('|');
            const gradleRe = new RegExp(`(?:${keys})\\s+['"]([^'"]+)['"]`, 'g');
            let gm;
            while ((gm = gradleRe.exec(content)) !== null) {
                // Format: group:artifact:version
                deps.push(gm[1]);
            }
            break;
        }
    }
    return [...new Set(deps)];
}
/**
 * Deduplicate ambiguous relations by (kind, from_file, reference).
 */
function dedupAmbiguous(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = `${item.kind}|${item.severity ?? ''}|${item.from_file}|${item.reference}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    }
    return result;
}
/**
 * Print compact text output
 */
function printCompact(result) {
    console.log(`Project languages: ${result.project_languages.join(', ') || '(none detected)'}`);
    console.log(`Discovered edges: ${result.summary.total_discovered}`);
    console.log(`  High confidence (>=0.7): ${result.summary.high_confidence}`);
    console.log(`  Low confidence (<0.7): ${result.summary.low_confidence}`);
    console.log(`Ambiguous references: ${result.ambiguous.length}`);
    console.log(`  Actionable (project files with no card): ${result.summary.actionable}`);
    console.log(`  Informational (external packages): ${result.summary.external_refs}`);
    if (result.discovered_edges.length > 0) {
        console.log('\nInferred Edges:');
        for (const edge of result.discovered_edges) {
            const icon = edge.confidence >= 0.8 ? '●' : edge.confidence >= 0.7 ? '○' : '◌';
            console.log(`  ${icon} ${edge.from_id} → ${edge.to_id} (${edge.type}, conf ${edge.confidence.toFixed(1)}, ${edge.evidence.language})`);
        }
    }
    if (result.ambiguous.length > 0) {
        // Show actionable items first so the agent's review is signal-first
        const actionable = result.ambiguous.filter(a => a.severity === 'actionable');
        const informational = result.ambiguous.filter(a => a.severity === 'informational');
        const other = result.ambiguous.filter(a => !a.severity);
        if (actionable.length > 0) {
            console.log('\n⚠ Actionable (consider creating a card):');
            for (const amb of actionable) {
                const tag = `[${amb.kind}]`;
                if (amb.kind === 'unmatched_target') {
                    console.log(`  ${tag} ${amb.from_file}: "${amb.reference}" → no matching card (${amb.language})`);
                }
                else if (amb.kind === 'multiple_targets') {
                    console.log(`  ${tag} ${amb.from_file}: "${amb.reference}" → ${amb.suggested_targets?.join(', ')} (${amb.language})`);
                }
                else if (amb.kind === 'low_confidence') {
                    console.log(`  ${tag} ${amb.reference} (conf ${amb.confidence?.toFixed(1)})`);
                }
            }
        }
        if (informational.length > 0) {
            console.log(`\n· Informational (external/builtin, no action): ${informational.length} item(s)`);
            // Show up to 5, then a count
            for (const amb of informational.slice(0, 5)) {
                console.log(`  [external] "${amb.reference}" from ${path.basename(amb.from_file)}`);
            }
            if (informational.length > 5) {
                console.log(`  ... and ${informational.length - 5} more (use --format json to see all)`);
            }
        }
        if (other.length > 0) {
            console.log('\nOther:');
            for (const amb of other) {
                const tag = `[${amb.kind}]`;
                console.log(`  ${tag} ${amb.reference} (${amb.language})`);
            }
        }
    }
}
//# sourceMappingURL=index.js.map