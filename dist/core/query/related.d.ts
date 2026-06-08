interface RelatedEdgeItem {
    direction: 'out' | 'in';
    target_id: string;
    target_title: string;
    target_type: string;
    target_status: string | null;
    source: string;
    confidence: number;
}
export interface RelatedResult {
    card: {
        id: string;
        type: string;
        title: string;
        status: string | null;
        file: string;
    };
    total_edges: number;
    edges_by_type: Record<string, RelatedEdgeItem[]>;
    high_confidence: RelatedEdgeItem[];
    needs_review: RelatedEdgeItem[];
}
export declare function relatedQuery(pmemPath: string, id: string, options?: {
    depth?: number;
    type?: string;
    source?: 'explicit' | 'inferred' | 'mention' | 'all';
}): RelatedResult;
export {};
//# sourceMappingURL=related.d.ts.map