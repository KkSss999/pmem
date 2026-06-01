import type { LanguagePattern } from '../../types';
/**
 * Language-level builtin / stdlib module names that should NEVER be treated as
 * project-internal references. Matching imports are silently dropped from
 * `discovered_edges` and `ambiguous` so the agent only sees actionable items.
 *
 * Format: bare name only (no `node:` prefix, no path). For namespaced builtins
 * (`fs/promises`, `node:fs`), the first segment is checked.
 */
export declare const BUILTIN_MODULES: Record<string, Set<string>>;
/**
 * Check if a target name is a language-level builtin (stdlib / core module / framework).
 * For namespaced targets (e.g. `fs/promises`, `node:fs`), checks the first segment
 * after stripping an optional `node:` prefix.
 * For dot-separated languages (java, python), checks if the target starts with
 * any of the prefix entries in the set (e.g. `org.springframework`, `java`).
 */
export declare function isBuiltinModule(target: string, language: string): boolean;
/**
 * Built-in language pattern registry for 6 major ecosystems.
 * Each language has: indicator files, source extensions, import patterns, dependency file patterns, and exclude dirs.
 */
export declare const BUILTIN_PATTERNS: Record<string, LanguagePattern>;
/**
 * Load the full pattern registry: builtin + manifest additional_patterns.
 * manifestPatterns take precedence (merge by language key).
 */
export declare function loadPatternRegistry(manifestPatterns?: LanguagePattern[]): LanguagePattern[];
//# sourceMappingURL=patterns.d.ts.map