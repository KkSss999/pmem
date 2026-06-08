/**
 * Validate that pmemPath is within (or equal to) the expected .pmem directory
 * under CWD. Resolves symlinks to prevent escape via symlink indirection.
 *
 * CRITICAL: Uses realpath + path.sep comparison, NOT bare startsWith(),
 * to prevent prefix-confusion attacks (e.g. .pmem-evil/ passing a
 * startsWith('.pmem/') check).
 */
export declare function validatePathScope(pmemPath: string): void;
/**
 * Enforce an approximate token budget on a JSON-serializable result object.
 * If the serialized form exceeds maxTokens, truncates body/content fields
 * and sets { truncated: true, ... } on the result.
 */
export declare function enforceBudget(result: any, maxTokens: number): any;
/**
 * Mark all card/match objects in the result with content_trust metadata.
 * Does NOT modify, redact, or filter card content — purely additive.
 */
export declare function addContentTrust(result: any): any;
//# sourceMappingURL=security.d.ts.map