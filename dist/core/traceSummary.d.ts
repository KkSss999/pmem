export interface ChangedFile {
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
}
export interface TraceSummaryInput {
    cwd: string;
    pmemPath: string;
    changedFiles: ChangedFile[];
    userSummary?: string;
    next?: string;
    latestTask?: string;
}
export interface TraceSummaryResult {
    title: string;
    summary: string;
    whatChanged: string[];
    why: string[];
    architectureNotes: string[];
    decisions: string[];
    affectedModules: string[];
    changedFiles: ChangedFile[];
    next: string[];
    confidence: 'low' | 'medium' | 'high';
}
export declare function buildTraceSummary(input: TraceSummaryInput): TraceSummaryResult;
//# sourceMappingURL=traceSummary.d.ts.map