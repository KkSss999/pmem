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
exports.validatePathScope = validatePathScope;
exports.enforceBudget = enforceBudget;
exports.addContentTrust = addContentTrust;
exports.validateCaptureInputs = validateCaptureInputs;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Validate that pmemPath is within (or equal to) the expected .pmem directory
 * under CWD. Resolves symlinks to prevent escape via symlink indirection.
 *
 * CRITICAL: Uses realpath + path.sep comparison, NOT bare startsWith(),
 * to prevent prefix-confusion attacks (e.g. .pmem-evil/ passing a
 * startsWith('.pmem/') check).
 */
function validatePathScope(pmemPath) {
    const cwd = process.cwd();
    const expectedRoot = path.join(cwd, '.pmem');
    let realPmemPath;
    let allowedRoot;
    try {
        realPmemPath = fs.realpathSync(pmemPath);
    }
    catch {
        throw new Error(`Path scope violation: cannot resolve pmem path "${pmemPath}"`);
    }
    try {
        allowedRoot = fs.realpathSync(expectedRoot);
    }
    catch {
        throw new Error(`Path scope violation: cannot resolve allowed root "${expectedRoot}"`);
    }
    // Exact match OR realPmemPath starts with allowedRoot + path.sep
    // Using path.sep prevents prefix confusion (e.g., .pmem-evil would not
    // match .pmem/ since the path separator differs).
    const isExact = realPmemPath === allowedRoot;
    const isChild = realPmemPath.startsWith(allowedRoot + path.sep);
    if (!isExact && !isChild) {
        throw new Error(`Path scope violation: "${realPmemPath}" is outside the allowed directory "${allowedRoot}"`);
    }
}
/**
 * Enforce an approximate token budget on a JSON-serializable result object.
 * If the serialized form exceeds maxTokens, truncates body/content fields
 * and sets { truncated: true, ... } on the result.
 */
function enforceBudget(result, maxTokens) {
    const jsonStr = JSON.stringify(result);
    const tokenEstimate = jsonStr.split(/\s+/).length;
    if (tokenEstimate <= maxTokens) {
        result.original_tokens = tokenEstimate;
        return result;
    }
    // Truncate body/content fields to fit the budget
    const truncated = truncateFields(result, maxTokens);
    truncated.truncated = true;
    truncated.truncated_reason = `Output exceeds max_response_tokens (${maxTokens})`;
    truncated.original_tokens = tokenEstimate;
    return truncated;
}
function truncateFields(obj, maxTokens) {
    if (typeof obj !== 'object' || obj === null)
        return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => truncateFields(item, maxTokens));
    }
    const result = {};
    for (const key of Object.keys(obj)) {
        if (key === 'body' || key === 'content') {
            const val = typeof obj[key] === 'string' ? obj[key] : JSON.stringify(obj[key]);
            // Rough: keep first ~maxTokens/2 words
            const words = val.split(/\s+/);
            result[key] = words.slice(0, Math.floor(maxTokens / 2)).join(' ') +
                ' [truncated for token budget]';
        }
        else {
            result[key] = truncateFields(obj[key], maxTokens);
        }
    }
    return result;
}
/**
 * Mark all card/match objects in the result with content_trust metadata.
 * Does NOT modify, redact, or filter card content — purely additive.
 */
function addContentTrust(result) {
    if (typeof result !== 'object' || result === null)
        return result;
    // Walk the result tree and tag card-like objects
    function walk(obj) {
        if (typeof obj !== 'object' || obj === null)
            return;
        // Tag objects that look like cards: have an id plus title, file, or match_type.
        // Covers CardRow (has type), AskMatchV03 (no type), and RelatedEdgeItem.
        const hasCardShape = obj.id !== undefined && (obj.title !== undefined || obj.file !== undefined || obj.match_type !== undefined ||
            obj.target_id !== undefined);
        if (hasCardShape) {
            obj.content_trust = 'untrusted_project_data';
        }
        // Recurse into all nested structures
        if (Array.isArray(obj)) {
            for (const item of obj)
                walk(item);
        }
        else {
            for (const key of Object.keys(obj)) {
                const val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    walk(val);
                }
            }
        }
    }
    walk(result);
    return result;
}
/**
 * Validate MCP capture inputs for security constraints (lengths, boundaries).
 */
function validateCaptureInputs(pmemPath, summary, next) {
    // Validate path scope first
    validatePathScope(pmemPath);
    // Validate lengths to prevent denial of service (DoS)
    if (summary && summary.length > 2000) {
        throw new Error('Security: summary input exceeds max size of 2000 characters');
    }
    if (next && next.length > 2000) {
        throw new Error('Security: next input exceeds max size of 2000 characters');
    }
    // Prevent control characters in inputs
    const controlCharRegex = /[\x00-\x1F\x7F]/;
    if (summary && controlCharRegex.test(summary)) {
        throw new Error('Security: summary input contains invalid control characters');
    }
    if (next && controlCharRegex.test(next)) {
        throw new Error('Security: next input contains invalid control characters');
    }
    // Prevent reserved comment markers to avoid markdown injection
    const forbiddenMarkers = [
        '<!-- pmem:next:start -->',
        '<!-- pmem:next:end -->',
        '<!-- pmem:rules:start -->',
        '<!-- pmem:rules:end -->'
    ];
    for (const marker of forbiddenMarkers) {
        if (summary?.includes(marker) || next?.includes(marker)) {
            throw new Error('Security: capture input contains reserved pmem marker');
        }
    }
}
//# sourceMappingURL=security.js.map