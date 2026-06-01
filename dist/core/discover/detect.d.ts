import type { LanguagePattern } from '../../types';
/**
 * Auto-detect languages from indicator files in the project root.
 * Returns language names matching the LanguagePattern registry keys.
 */
export declare function detectLanguages(rootDir: string, patterns: LanguagePattern[]): string[];
/**
 * Filter patterns to only the specified languages.
 * If langs is ['auto'] or empty, return all patterns.
 */
export declare function filterPatterns(patterns: LanguagePattern[], langs: string[]): LanguagePattern[];
//# sourceMappingURL=detect.d.ts.map