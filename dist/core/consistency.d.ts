import type { ConsistencyIssue } from '../types';
/**
 * Check for stale memory: cards whose source_files have been modified
 * after the card was last updated or verified.
 *
 * Shared between verify.ts and update.ts so that verify/suggest
 * semantics stay aligned.
 */
export declare function checkStaleMemory(pmemPath: string): ConsistencyIssue[];
//# sourceMappingURL=consistency.d.ts.map