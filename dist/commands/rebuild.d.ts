interface RebuildOptions {
    changed?: boolean;
    full?: boolean;
    card?: string;
}
export declare function rebuildCommand(options?: RebuildOptions): void;
/**
 * Extract [[card-id]] wikilink references from markdown body text.
 * Matches standard pmem card ID patterns: type.name (e.g. [[character.zero]],
 * [[module.auth]], [[decision.jwt_tokens]]).
 * Returns deduplicated array of card IDs.
 */
export declare function extractWikilinks(bodyText: string): string[];
export {};
//# sourceMappingURL=rebuild.d.ts.map