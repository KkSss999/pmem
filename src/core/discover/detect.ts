import * as path from 'path';
import { fileExists } from '../fs';
import type { LanguagePattern } from '../../types';

/**
 * Auto-detect languages from indicator files in the project root.
 * Returns language names matching the LanguagePattern registry keys.
 */
export function detectLanguages(rootDir: string, patterns: LanguagePattern[]): string[] {
  const detected: string[] = [];

  for (const pattern of patterns) {
    for (const indicator of pattern.indicators) {
      const indicatorPath = path.join(rootDir, indicator);
      if (fileExists(indicatorPath)) {
        detected.push(pattern.language);
        break; // one indicator is enough
      }
    }
  }

  return detected;
}

/**
 * Filter patterns to only the specified languages.
 * If langs is ['auto'] or empty, return all patterns.
 */
export function filterPatterns(
  patterns: LanguagePattern[],
  langs: string[],
): LanguagePattern[] {
  if (!langs || langs.length === 0 || (langs.length === 1 && langs[0] === 'auto')) {
    return patterns;
  }

  const langSet = new Set(langs.map(l => l.toLowerCase()));
  return patterns.filter(p => langSet.has(p.language));
}
