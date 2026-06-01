"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeHash = computeHash;
exports.computeCardHashes = computeCardHashes;
exports.tokenCount = tokenCount;
exports.sectionCount = sectionCount;
const crypto_1 = require("crypto");
function computeHash(content) {
    return (0, crypto_1.createHash)('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
}
function computeCardHashes(fullContent, frontmatterText, bodyText) {
    return {
        fileHash: computeHash(fullContent),
        frontmatterHash: computeHash(frontmatterText),
        bodyHash: computeHash(bodyText),
    };
}
function tokenCount(text) {
    // Rough token estimation: ~4 chars per token for mixed zh/en text
    return Math.ceil(text.replace(/\s+/g, ' ').length / 4);
}
function sectionCount(body) {
    return (body.match(/^## /gm) || []).length;
}
//# sourceMappingURL=hash.js.map