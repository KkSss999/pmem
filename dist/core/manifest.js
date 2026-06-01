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
exports.getDefaultManifest = getDefaultManifest;
exports.getDefaultManifestV03 = getDefaultManifestV03;
exports.loadManifest = loadManifest;
exports.saveManifest = saveManifest;
const yaml = __importStar(require("js-yaml"));
const fs = __importStar(require("./fs"));
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