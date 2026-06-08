export interface StatusResult {
    checked_at: string;
    source: 'git' | 'mtime';
    changes: Array<{
        path: string;
        status: string;
        related_cards: Array<{
            card_id: string;
            match_type: string;
        }>;
    }>;
    affected_cards: Array<{
        card_id: string;
        match_type: string;
        matched_file?: string;
        matched_dir?: string;
        via_card?: string;
    }>;
    suggested_action: string | null;
}
export declare function statusQuery(pmemPath: string, options?: {
    since?: string;
}): StatusResult;
//# sourceMappingURL=status.d.ts.map