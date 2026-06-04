export interface RelatedCardRef {
    card_id: string;
    match_type: string;
}
export interface FileChange {
    path: string;
    status: string;
    relatedCards: RelatedCardRef[];
}
export declare function statusCommand(options: {
    since?: string;
    format?: string;
}): void;
export declare function getChangedFiles(cwd: string, since?: string): FileChange[];
//# sourceMappingURL=status.d.ts.map