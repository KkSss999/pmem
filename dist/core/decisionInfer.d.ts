export interface InferredDecision {
    id: string;
    title: string;
    statement: string;
    reason: string;
    evidence: string[];
    related: string[];
    source_files: string[];
}
export declare function inferDecisions(pmemPath: string): InferredDecision[];
export declare function writeInferredDecisions(pmemPath: string, decisions: InferredDecision[]): string[];
export declare function writeDecisionCandidates(pmemPath: string, decisions: InferredDecision[]): string;
//# sourceMappingURL=decisionInfer.d.ts.map