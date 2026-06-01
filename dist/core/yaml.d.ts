/**
 * Simple inline YAML parser for pmem's constrained frontmatter format.
 * Handles: top-level scalars, nested objects (one level), list items, inline arrays.
 */
export declare function parseSimpleYaml(yaml: string): Record<string, unknown>;
export declare function parseYamlValue(val: string): string | boolean | number | string[];
export declare function parseFrontmatter(content: string): {
    data: Record<string, unknown>;
    body: string;
} | null;
//# sourceMappingURL=yaml.d.ts.map