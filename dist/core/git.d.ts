export interface GitStatusChange {
    status: string;
    path: string;
}
export declare function parseGitStatusPorcelain(output: string): GitStatusChange[];
//# sourceMappingURL=git.d.ts.map