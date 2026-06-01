export declare function computeHash(content: string): string;
export interface CardHashes {
    fileHash: string;
    frontmatterHash: string;
    bodyHash: string;
}
export declare function computeCardHashes(fullContent: string, frontmatterText: string, bodyText: string): CardHashes;
export declare function tokenCount(text: string): number;
export declare function sectionCount(body: string): number;
//# sourceMappingURL=hash.d.ts.map