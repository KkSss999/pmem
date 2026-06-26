export interface ParsedTrace {
    id: string;
    title: string;
    summary: string;
    whatChanged: string[];
    why: string[];
    architectureNotes: string[];
    decisions: string[];
    next: string[];
    changedFiles: string[];
    createdAt: string;
}
export declare function parseTraceCard(content: string): ParsedTrace | null;
//# sourceMappingURL=traceParse.d.ts.map