"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const hash_1 = require("./hash");
(0, node_test_1.describe)('computeHash', () => {
    (0, node_test_1.it)('returns a deterministic output for the same input', () => {
        const input = 'hello world';
        const hash1 = (0, hash_1.computeHash)(input);
        const hash2 = (0, hash_1.computeHash)(input);
        node_assert_1.default.strictEqual(hash1, hash2);
    });
    (0, node_test_1.it)('returns different hashes for different inputs', () => {
        const hash1 = (0, hash_1.computeHash)('hello');
        const hash2 = (0, hash_1.computeHash)('world');
        node_assert_1.default.notStrictEqual(hash1, hash2);
    });
    (0, node_test_1.it)('returns a 16-character hex string', () => {
        const hash = (0, hash_1.computeHash)('test');
        node_assert_1.default.strictEqual(hash.length, 16);
        node_assert_1.default.ok(/^[0-9a-f]{16}$/.test(hash));
    });
    (0, node_test_1.it)('handles empty string', () => {
        const hash = (0, hash_1.computeHash)('');
        node_assert_1.default.strictEqual(typeof hash, 'string');
        node_assert_1.default.strictEqual(hash.length, 16);
    });
    (0, node_test_1.it)('handles long text', () => {
        const longText = 'a'.repeat(10000);
        const hash = (0, hash_1.computeHash)(longText);
        node_assert_1.default.strictEqual(hash.length, 16);
    });
});
(0, node_test_1.describe)('computeCardHashes', () => {
    (0, node_test_1.it)('returns fileHash, frontmatterHash, and bodyHash all different', () => {
        const fullContent = '---\nid: test\n---\nBody text';
        const frontmatterText = 'id: test';
        const bodyText = 'Body text';
        const hashes = (0, hash_1.computeCardHashes)(fullContent, frontmatterText, bodyText);
        node_assert_1.default.ok(hashes.fileHash);
        node_assert_1.default.ok(hashes.frontmatterHash);
        node_assert_1.default.ok(hashes.bodyHash);
        node_assert_1.default.notStrictEqual(hashes.fileHash, hashes.frontmatterHash);
        node_assert_1.default.notStrictEqual(hashes.fileHash, hashes.bodyHash);
        node_assert_1.default.notStrictEqual(hashes.frontmatterHash, hashes.bodyHash);
    });
    (0, node_test_1.it)('returns identical fileHash for identical full content', () => {
        const content = '---\nid: test\n---\nBody';
        const h1 = (0, hash_1.computeCardHashes)(content, 'id: test', 'Body');
        const h2 = (0, hash_1.computeCardHashes)(content, 'id: test', 'Body');
        node_assert_1.default.strictEqual(h1.fileHash, h2.fileHash);
        node_assert_1.default.strictEqual(h1.frontmatterHash, h2.frontmatterHash);
        node_assert_1.default.strictEqual(h1.bodyHash, h2.bodyHash);
    });
    (0, node_test_1.it)('body changes produce different bodyHash but same frontmatterHash', () => {
        const h1 = (0, hash_1.computeCardHashes)('---\nid: test\n---\nBody A', 'id: test', 'Body A');
        const h2 = (0, hash_1.computeCardHashes)('---\nid: test\n---\nBody B', 'id: test', 'Body B');
        node_assert_1.default.strictEqual(h1.frontmatterHash, h2.frontmatterHash);
        node_assert_1.default.notStrictEqual(h1.bodyHash, h2.bodyHash);
        node_assert_1.default.notStrictEqual(h1.fileHash, h2.fileHash);
    });
});
(0, node_test_1.describe)('tokenCount', () => {
    (0, node_test_1.it)('estimates English text tokens', () => {
        // ~4 chars per token
        const text = 'This is a simple English sentence for testing.';
        const count = (0, hash_1.tokenCount)(text);
        node_assert_1.default.ok(count > 0);
        node_assert_1.default.ok(count < text.length);
    });
    (0, node_test_1.it)('estimates Chinese text tokens', () => {
        // Chinese chars are denser per token
        const text = '这是一个中文句子用于测试分词效果';
        const count = (0, hash_1.tokenCount)(text);
        node_assert_1.default.ok(count > 0);
    });
    (0, node_test_1.it)('returns higher count for longer text', () => {
        const short = (0, hash_1.tokenCount)('hi');
        const long = (0, hash_1.tokenCount)('this is a much longer piece of text with many more words');
        node_assert_1.default.ok(long > short);
    });
    (0, node_test_1.it)('handles mixed Chinese and English text', () => {
        const text = 'This is English 和中文 mixed together';
        const count = (0, hash_1.tokenCount)(text);
        node_assert_1.default.ok(count > 0);
    });
    (0, node_test_1.it)('returns 1 for very short input', () => {
        const count = (0, hash_1.tokenCount)('a');
        node_assert_1.default.strictEqual(count, 1);
    });
    (0, node_test_1.it)('returns 0 for empty string', () => {
        const count = (0, hash_1.tokenCount)('');
        node_assert_1.default.strictEqual(count, 0);
    });
});
(0, node_test_1.describe)('sectionCount', () => {
    (0, node_test_1.it)('counts ## headings', () => {
        const body = '## Section 1\ncontent\n## Section 2\nmore content';
        node_assert_1.default.strictEqual((0, hash_1.sectionCount)(body), 2);
    });
    (0, node_test_1.it)('returns 0 for body with no ## headings', () => {
        const body = 'Just some text\nwith no headings at all.';
        node_assert_1.default.strictEqual((0, hash_1.sectionCount)(body), 0);
    });
    (0, node_test_1.it)('does not count ### sub-headings', () => {
        const body = '## Main\n### Sub\n### Sub2\n## Main2';
        node_assert_1.default.strictEqual((0, hash_1.sectionCount)(body), 2);
    });
    (0, node_test_1.it)('does not count # h1 headings', () => {
        const body = '# Title\n## Section 1\nContent';
        node_assert_1.default.strictEqual((0, hash_1.sectionCount)(body), 1);
    });
    (0, node_test_1.it)('returns 0 for empty body', () => {
        node_assert_1.default.strictEqual((0, hash_1.sectionCount)(''), 0);
    });
});
//# sourceMappingURL=hash.test.js.map