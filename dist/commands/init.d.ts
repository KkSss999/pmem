export interface DomainPreset {
    domain: string;
    card_types: string[];
    type_dirs: Record<string, string>;
    foundational_types: string[];
    evidence_types: string[];
    default_type: string;
    creatable_types: string[];
    max_tokens?: Record<string, number>;
    max_sections?: Record<string, number>;
}
export declare const DOMAIN_PRESETS: Record<string, DomainPreset>;
export declare function initCommand(options: {
    guided?: boolean;
    projectName?: string;
    description?: string;
    stage?: string;
    next?: string;
    answers?: string;
    domain?: string;
}): Promise<void>;
//# sourceMappingURL=init.d.ts.map