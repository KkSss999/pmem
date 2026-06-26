export interface InferredModule {
    id: string;
    title: string;
    purpose: string;
    source_files: string[];
    current_knowledge: string[];
    open_questions: string[];
}
export declare function inferModules(cwd: string): InferredModule[];
export declare function writeInferredModules(pmemPath: string, modules: InferredModule[]): string[];
//# sourceMappingURL=moduleInfer.d.ts.map