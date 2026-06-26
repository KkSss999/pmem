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
    recent_traces?: Array<{
        id: string;
        title: string;
        summary: string;
        file_path: string;
        created_at: string;
        changed_files: string[];
        what_changed: string[];
        decisions: string[];
        architecture_notes: string[];
        next: string[];
    }>;
    architecture?: Array<{
        id: string;
        title: string;
        summary: string | null;
        file_path: string;
        source_files: string[];
    }>;
    decisions?: Array<{
        id: string;
        title: string;
        summary: string | null;
        file_path: string;
    }>;
    context_summary?: string[];
}
export declare function recallQuery(pmemPath: string, options?: {
    budget?: number;
    since?: string;
    recent?: number;
    noTraces?: boolean;
}): RecallQueryResult;
//# sourceMappingURL=recall.d.ts.map