import type { CliFormat } from '../../types';
/**
 * Main discover command: detect languages, scan files, resolve to cards, produce edges.
 */
export declare function discoverCommand(options: {
    format?: CliFormat;
    dryRun?: boolean;
    minConfidence?: number;
    lang?: string;
    patternFile?: string;
}): void;
//# sourceMappingURL=index.d.ts.map