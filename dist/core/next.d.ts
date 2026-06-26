export interface NextState {
    nextStep: string;
    why?: string;
    context?: string[];
}
export declare function readNext(pmemPath: string): NextState;
export declare function writeManagedNext(pmemPath: string, nextState: NextState): void;
export declare function migrateNextIfNeeded(pmemPath: string): void;
//# sourceMappingURL=next.d.ts.map