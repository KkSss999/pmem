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
exports.V064_DEFAULT_CREATABLE_TYPES = exports.V064_DEFAULT_MERGE_TYPES = exports.V064_DEFAULT_TYPES = void 0;
exports.resolveConfig = resolveConfig;
exports.renderIdPattern = renderIdPattern;
exports.getDefaultManifest = getDefaultManifest;
exports.getDefaultManifestV03 = getDefaultManifestV03;
exports.loadManifest = loadManifest;
exports.saveManifest = saveManifest;
const yaml = __importStar(require("js-yaml"));
const fs = __importStar(require("./fs"));
// v0.7.0: v0.6.4 id_pattern whitelist — the exact types accepted at runtime.
// Sourced from src/core/manifest.ts:113 (card_policy.id_pattern regex).
exports.V064_DEFAULT_TYPES = [
    'project', 'module', 'feature', 'task', 'decision',
    'trace', 'risk', 'assumption', 'resource', 'integration',
];
// v0.7.0: v0.6.4 distill merge target types (hardcoded in distill.ts).
exports.V064_DEFAULT_MERGE_TYPES = ['module', 'decision', 'task', 'feature'];
// v0.7.0: v0.6.4 VALID_TYPES from new.ts — the exact 6 types `pmem new`
// accepted before v0.7.0. Narrower than id_pattern (10 types) because
// project/assumption/resource/integration exist for compat but are not
// creatable (their directories may be excluded from rebuild).
exports.V064_DEFAULT_CREATABLE_TYPES = ['decision', 'module', 'task', 'feature', 'risk', 'trace'];
/**
 * Compute a ResolvedConfig from a manifest object.
 *
 * v0.7.0 contract:
 * - If manifest.schema.card_types is defined → use it.
 * - Otherwise → fall back to the v0.6.4 id_pattern whitelist.
 * - This is a PURE FUNCTION — it does NOT write back to the manifest file.
 *   The only path that writes schema.* fields is `pmem init --domain ...`.
 */
function resolveConfig(manifest) {
    const schema = manifest.schema;
    const card_types = schema?.card_types ?? [...exports.V064_DEFAULT_TYPES];
    // type_dirs: built-in preset types must explicitly list directories;
    // custom types (not in any preset) fall back to `${type}s`.
    const type_dirs = {};
    for (const t of card_types) {
        if (schema?.type_dirs?.[t]) {
            type_dirs[t] = schema.type_dirs[t];
        }
        else {
            type_dirs[t] = `${t}s`;
        }
    }
    return {
        card_types,
        type_dirs,
        foundational_types: schema?.foundational_types ?? ['module'],
        evidence_types: schema?.evidence_types ?? ['decision', 'trace'],
        default_type: schema?.default_type ?? 'trace',
        merge_target_types: manifest.distill?.merge_target_types ?? [...exports.V064_DEFAULT_MERGE_TYPES],
        // creatable_types: types accepted by `pmem new`.
        // - If schema.creatable_types is defined → use it.
        // - Otherwise (compat fallback):
        //   - If schema.card_types is defined → all card_types minus non-creatable utility types ('integration', 'project', 'assumption', 'resource')
        //   - Otherwise → v0.6.4 default creatable types
        creatable_types: schema?.creatable_types
            ? schema.creatable_types
            : (schema?.card_types
                ? card_types.filter(t => t !== 'integration' && t !== 'project' && t !== 'assumption' && t !== 'resource')
                : [...exports.V064_DEFAULT_CREATABLE_TYPES]),
    };
}
/**
 * Render a card_policy.id_pattern by replacing the `{types}` placeholder
 * with the regex-escaped card type names.
 *
 * If the pattern contains `{types}`, it is replaced with the alternation
 * of all card_types (each regex-escaped).  If the pattern does NOT contain
 * `{types}`, it is returned unchanged (v0.6.4 compat).
 */
function renderIdPattern(idPattern, cardTypes) {
    if (!idPattern.includes('{types}'))
        return idPattern;
    const escaped = cardTypes.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return idPattern.replace('{types}', escaped.join('|'));
}
function getDefaultManifest(projectName, initMode = 'minimal') {
    return {
        pmem: {
            schema_version: '0.3',
            protocol_version: '0.3',
            created_by: '0.3.0',
            last_migrated_by: null,
        },
        project: {
            name: projectName,
            language: 'zh-CN',
            status: 'active',
        },
        memory_status: {
            completeness: initMode === 'guided' ? 'partial' : 'incomplete',
            initialized_mode: initMode,
            dirty: false,
            dirty_since: null,
            dirty_reason: null,
        },
        source_of_truth: {
            type: 'markdown_cards',
            path: '.pmem',
            card_globs: [
                '.pmem/modules/**/*.md',
                '.pmem/features/**/*.md',
                '.pmem/decisions/**/*.md',
                '.pmem/tasks/**/*.md',
                '.pmem/traces/**/*.md',
                '.pmem/risks/**/*.md',
            ],
        },
        runtime: {
            mode: 'sqlite',
            db_path: '.pmem/pmem.db',
            markdown_source: true,
        },
        indexes: {
            primary: 'sqlite',
            legacy_json: {
                enabled: false,
                retained: true,
                path: '.pmem/indexes',
            },
        },
        rebuild: {
            strategy: 'content_hash',
            hash: {
                file_hash: true,
                frontmatter_hash: true,
                body_hash: true,
            },
        },
        concurrency: {
            mode: 'file-basic',
            atomic_write: true,
            lock: {
                enabled: true,
                path: '.pmem/.lock',
                timeout: '3s',
                stale_after: '60s',
                on_timeout: 'abort',
            },
            optimistic_lock: {
                enabled: false,
                note: 'Deferred to SQLite runtime in v0.3',
            },
        },
        cli: {
            default_format: 'compact',
            supported_formats: ['compact', 'json', 'paths', 'pack'],
            default_budget: 1600,
        },
        embedding: {
            enabled: false,
            provider: 'none',
            model: null,
            dimension: null,
            store: 'sqlite',
            index: 'none',
        },
        serve: {
            enabled: false,
            mode: 'none',
            experimental: {
                mcp: false,
                rest: false,
            },
        },
        auto_update: {
            enabled: true,
            on_code_change: 'mark_dirty',
            on_doc_change: 'mark_dirty',
            on_memory_change: 'rebuild_indexes',
            on_session_end: 'prompt',
            on_git_commit: 'suggest_trace',
            min_trace_interval: '30m',
            max_auto_traces_per_day: 5,
            ignore_patterns: [
                'node_modules/**', 'dist/**', 'build/**', '*.lock', '*.log',
            ],
            trace_policy: {
                require_meaningful_change: true,
                require_summary: true,
                require_related_node: true,
            },
        },
        card_policy: {
            id_pattern: '^(project|module|feature|task|decision|trace|risk|assumption|resource|integration)\\.[a-z0-9._-]+$',
            max_tokens: { module: 1200, feature: 1000, decision: 1000, task: 800, trace: 1000 },
            max_sections: { module: 8, feature: 8, decision: 6, task: 6 },
            warn_when_related_count_gt: 12,
        },
        distill: {
            enabled: true,
            cadence: 'weekly',
            max_undistilled_traces: 20,
            require_confirmation: true,
            suggest_card_splits: true,
        },
        freshness: {
            default_ttl: '14d',
            stale_on_related_code_change: true,
            require_last_verified: true,
        },
        integrations: {
            active: [],
        },
        migrations: {
            applied: [],
        },
    };
}
function getDefaultManifestV03(projectName, initMode = 'minimal') {
    return getDefaultManifest(projectName, initMode);
}
function loadManifest(pmemDir) {
    const filePath = `${pmemDir}/manifest.yml`;
    const content = fs.readFile(filePath);
    if (!content)
        return null;
    try {
        return yaml.load(content);
    }
    catch {
        return null;
    }
}
function saveManifest(pmemDir, manifest) {
    const yamlStr = yaml.dump(manifest, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
    });
    // Use atomic write for manifest to prevent corruption
    const filePath = `${pmemDir}/manifest.yml`;
    const fsModule = require('./fs');
    if (fsModule.atomicWrite) {
        fsModule.atomicWrite(filePath, yamlStr);
    }
    else {
        fs.writeFile(filePath, yamlStr);
    }
}
//# sourceMappingURL=manifest.js.map