export interface RecallQueryResult {
    project: string;
    stage?: string;
    focus: string;
    state: string[];
    next: string;
    mustRead: string[];
    dirty_flags_count: number;
    recent_updates: Array<{
        action: string;
        summary: string | null;
        created_at: string;
    }>;
    active_modules: string[];
    active_foundation: string[];
}
export declare function recallQuery(pmemPath: string, options?: {
    budget?: number;
    since?: string;
}): RecallQueryResult;
//# sourceMappingURL=recall.d.ts.map