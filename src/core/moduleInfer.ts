import * as path from 'path';
import * as fs from 'fs';
import { fileExists, ensureDir, atomicWrite, toPosixPath } from './fs';

export interface InferredModule {
  id: string;
  title: string;
  purpose: string;
  source_files: string[];
  current_knowledge: string[];
  open_questions: string[];
}

interface KnowledgePattern {
  text: string;
  appliesTo: string[];  // whitelist (empty = all)
  excludes?: string[];  // blacklist
  match: (content: string, moduleKey: string, filePath: string) => boolean;
}

const KNOWLEDGE_PATTERNS: KnowledgePattern[] = [
  {
    text: 'Game loop uses requestAnimationFrame for smooth execution.',
    appliesTo: ['engine'],
    excludes: ['audio', 'renderer', 'ui', 'api', 'storage', 'config'],
    match: (c) => c.includes('requestAnimationFrame')
  },
  {
    text: 'Targets a predictable mobile-style 320x560 portrait viewport.',
    appliesTo: ['engine', 'renderer', 'ui'],
    excludes: ['audio', 'api', 'storage', 'config'],
    match: (c) => c.includes('320') && c.includes('560')
  },
  {
    text: 'Score state tracking and score updates are implemented.',
    appliesTo: ['engine', 'ui'],
    excludes: ['audio', 'renderer', 'api', 'storage', 'config'],
    match: (c) => c.includes('score') || c.includes('scoreState')
  }
];

const MODULE_HINTS: Record<string, { title: string; purpose: string; keywords: string[] }> = {
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

function buildSourceFiles(file: string, coarse: boolean): string[] {
  if (!coarse) return [file];
  const parts = file.split('/');
  if (parts[0] === 'src' && parts.length > 2) {
    return [`src/${parts[1]}/`];
  }
  return [file];
}

export function inferModules(cwd: string, options?: { coarseAttribution?: boolean }): InferredModule[] {
  const fileList: string[] = [];
  try {
    scanDir(cwd, cwd, fileList);
  } catch {
    return [];
  }

  const moduleFilesMap = new Map<string, Set<string>>();
  const moduleKnowledgeMap = new Map<string, Set<string>>();

  // Initialize maps
  for (const key of Object.keys(MODULE_HINTS)) {
    moduleFilesMap.set(key, new Set());
    moduleKnowledgeMap.set(key, new Set());
  }

  const coarse = options?.coarseAttribution === true;

  // Scan files and classify
  for (const file of fileList) {
    const lowerPath = file.toLowerCase();
    const basename = path.basename(file).toLowerCase();
    const ext = path.extname(file).toLowerCase();

    let content = '';
    if (ext === '.jsx' || ext === '.tsx' || ext === '.js' || ext === '.ts' || ext === '.css' || basename === 'package.json') {
      try {
        content = fs.readFileSync(path.join(cwd, file), 'utf8');
      } catch {}
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
        // Associate file with module (file-level by default; directory-level when coarseAttribution=true)
        for (const sf of buildSourceFiles(file, coarse)) {
          moduleFilesMap.get(key)?.add(sf);
        }

        // Try extracting specific knowledge (module-scope guarded)
        if (content) {
          for (const pattern of KNOWLEDGE_PATTERNS) {
            if (pattern.appliesTo.length > 0 && !pattern.appliesTo.includes(key)) continue;
            if (pattern.excludes?.includes(key)) continue;
            if (pattern.match(content, key, file)) {
              moduleKnowledgeMap.get(key)?.add(pattern.text);
            }
          }
        }
      }
    }
  }

  // Build final list of inferred modules
  const inferred: InferredModule[] = [];
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

function scanDir(dir: string, cwd: string, fileList: string[]) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = toPosixPath(path.relative(cwd, fullPath));
    if (['node_modules', '.git', '.pmem', 'dist', 'build', 'temp', 'walkthrough.md'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      scanDir(fullPath, cwd, fileList);
    } else {
      fileList.push(relPath);
    }
  }
}

export function writeInferredModules(pmemPath: string, modules: InferredModule[]): string[] {
  const writtenPaths: string[] = [];
  const modulesDir = path.join(pmemPath, 'modules');
  ensureDir(modulesDir);

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

    atomicWrite(filePath, content);
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}
