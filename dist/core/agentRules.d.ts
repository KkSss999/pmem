interface InstallRulesOptions {
    claude?: boolean;
    codex?: boolean;
    gemini?: boolean;
    cursor?: boolean;
    cline?: boolean;
    aider?: boolean;
    windsurf?: boolean;
    all?: boolean;
}
export declare function writeAgentRules(cwd: string, options: InstallRulesOptions): string[];
export {};
//# sourceMappingURL=agentRules.d.ts.map