type MatchType = 'exact_id' | 'exact_title' | 'alias' | 'tag' | 'graph_expansion' | 'keyword_fallback';
interface AskMatchV03 {
    id: string;
    title: string;
    match_type: MatchType;
    confidence: number;
    graph_distance: number;
    file: string;
    edge_type?: string;
    from_card?: string;
}
export interface AskResultV03 {
    query: string;
    matched: AskMatchV03[];
    recommended_files: string[];
    evidence_paths: string[];
}
export declare function askQuery(pmemPath: string, query: string): AskResultV03;
export {};
//# sourceMappingURL=ask.d.ts.map