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
exports.inferModules = inferModules;
exports.writeInferredModules = writeInferredModules;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fs_1 = require("./fs");
const MODULE_HINTS = {
    engine: {
        title: 'Engine',
        purpose: 'Owns game loop, state update, timing, and collision-related logic.',
        keywords: ['engine', 'loop', 'gameloop', 'state', 'physics', 'collision']
    },
    renderer: {
        title: 'Renderer',
        purpose: 'Handles canvas drawing, drawing context, sprite rendering, and visual scenes.',
        keywords: ['renderer', 'canvas', 'draw', 'sprite', 'scene', 'render']
    },
    audio: {
        title: 'Audio',
        purpose: 'Manages game audio, sound effects, music, and sound players.',
        keywords: ['audio', 'sound', 'music', 'sfx', 'volume']
    },
    ui: {
        title: 'UI',
        purpose: 'Manages user interfaces, React shell components, CSS layout, and user input elements.',
        keywords: ['app.jsx', 'app.tsx', 'components', 'styles', 'css', 'layout', 'ui', 'view', 'page']
    },
    api: {
        title: 'API',
        purpose: 'Handles network requests, HTTP clients, routes, server endpoints, and API communication.',
        keywords: ['api', 'client', 'server', 'routes', 'fetch', 'axios', 'request']
    },
    storage: {
        title: 'Storage',
        purpose: 'Manages data persistence, database records, SQLite index queries, and local storage repositories.',
        keywords: ['db', 'sqlite', 'storage', 'repo', 'database', 'persistence']
    },
    config: {
        title: 'Config',
        purpose: 'Manages build settings, compiler configuration, env variables, and tooling configs.',
        keywords: ['config', 'vite', 'webpack', 'tsconfig', 'package.json', 'settings']
    }
};
function inferModules(cwd) {
    const fileList = [];
    try {
        scanDir(cwd, cwd, fileList);
    }
    catch {
        return [];
    }
    const moduleFilesMap = new Map();
    const moduleKnowledgeMap = new Map();
    // Initialize maps
    for (const key of Object.keys(MODULE_HINTS)) {
        moduleFilesMap.set(key, new Set());
        moduleKnowledgeMap.set(key, new Set());
    }
    // Scan files and classify
    for (const file of fileList) {
        const lowerPath = file.toLowerCase();
        const basename = path.basename(file).toLowerCase();
        const ext = path.extname(file).toLowerCase();
        let content = '';
        if (ext === '.jsx' || ext === '.tsx' || ext === '.js' || ext === '.ts' || ext === '.css' || basename === 'package.json') {
            try {
                content = fs.readFileSync(path.join(cwd, file), 'utf8');
            }
            catch { }
        }
        // Check classification keywords
        for (const [key, hint] of Object.entries(MODULE_HINTS)) {
            let isMatch = hint.keywords.some(kw => {
                if (kw.includes('.')) {
                    return basename === kw;
                }
                return lowerPath.includes(kw);
            });
            if (!isMatch && content) {
                if (key === 'engine' && (content.includes('requestAnimationFrame') || content.includes('loop(') || content.includes('collision'))) {
                    isMatch = true;
                }
                if (key === 'renderer' && (content.includes('getContext') || content.includes('clearRect') || content.includes('canvas'))) {
                    isMatch = true;
                }
            }
            if (isMatch) {
                // Associate file with module
                // If file is inside a src subdirectory, prefer to reference the subdirectory itself
                const parts = file.split(path.sep);
                if (parts[0] === 'src' && parts.length > 2) {
                    moduleFilesMap.get(key)?.add(`src/${parts[1]}/`);
                }
                else {
                    moduleFilesMap.get(key)?.add(file);
                }
                // Try extracting specific knowledge
                if (content) {
                    if (content.includes('requestAnimationFrame')) {
                        moduleKnowledgeMap.get(key)?.add('Game loop uses requestAnimationFrame for smooth execution.');
                    }
                    if (content.includes('320') && content.includes('560')) {
                        moduleKnowledgeMap.get(key)?.add('Targets a predictable mobile-style 320x560 portrait viewport.');
                    }
                    if (content.includes('score') || content.includes('scoreState')) {
                        moduleKnowledgeMap.get(key)?.add('Score state tracking and score updates are implemented.');
                    }
                }
            }
        }
    }
    // Build final list of inferred modules
    const inferred = [];
    for (const [key, hint] of Object.entries(MODULE_HINTS)) {
        const files = Array.from(moduleFilesMap.get(key) || []);
        if (files.length > 0) {
            const knowledge = Array.from(moduleKnowledgeMap.get(key) || []);
            if (knowledge.length === 0) {
                knowledge.push(`Contains source files: ${files.join(', ')}.`);
            }
            inferred.push({
                id: `module.${key}`,
                title: hint.title,
                purpose: hint.purpose,
                source_files: files,
                current_knowledge: knowledge,
                open_questions: [
                    `Should we split or restructure the responsibilities in ${hint.title}?`
                ]
            });
        }
    }
    return inferred;
}
function scanDir(dir, cwd, fileList) {
    if (!fs.existsSync(dir))
        return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(cwd, fullPath);
        if (['node_modules', '.git', '.pmem', 'dist', 'build', 'temp', 'walkthrough.md'].includes(entry.name))
            continue;
        if (entry.isDirectory()) {
            scanDir(fullPath, cwd, fileList);
        }
        else {
            fileList.push(relPath);
        }
    }
}
function writeInferredModules(pmemPath, modules) {
    const writtenPaths = [];
    const modulesDir = path.join(pmemPath, 'modules');
    (0, fs_1.ensureDir)(modulesDir);
    for (const m of modules) {
        const filename = `${m.id}.md`;
        const filePath = path.join(modulesDir, filename);
        const content = `---
id: ${m.id}
type: module
status: active
tags:
  - inferred
  - software
updated: "${new Date().toISOString()}"
source_files:
${m.source_files.map(sf => `  - ${sf}`).join('\n')}
---

# ${m.title}

## Purpose
${m.purpose}

## Current knowledge
${m.current_knowledge.map(k => `- ${k}`).join('\n')}

## Source files
${m.source_files.map(sf => `- ${sf}`).join('\n')}

## Related traces
- (none)

## Open questions
${m.open_questions.map(q => `- ${q}`).join('\n')}
`;
        (0, fs_1.atomicWrite)(filePath, content);
        writtenPaths.push(filePath);
    }
    return writtenPaths;
}
//# sourceMappingURL=moduleInfer.js.map