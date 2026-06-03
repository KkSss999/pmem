"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const rebuild_1 = require("../commands/rebuild");
(0, node_test_1.describe)('extractWikilinks', () => {
    (0, node_test_1.it)('extracts a single [[card-id]] from body text', () => {
        const body = 'The protagonist [[character.zero]] enters the room.';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, ['character.zero']);
    });
    (0, node_test_1.it)('extracts multiple distinct [[card-id]] references', () => {
        const body = `## Scene

[[character.zero]] meets [[character.lin-zhixu]] at [[world.shiyu]].

They discuss the events of [[chapter.vol1]].`;
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids.sort(), [
            'chapter.vol1',
            'character.lin-zhixu',
            'character.zero',
            'world.shiyu',
        ].sort());
    });
    (0, node_test_1.it)('deduplicates repeated references', () => {
        const body = '[[character.zero]] appears. Then [[character.zero]] speaks. [[character.zero]] leaves.';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, ['character.zero']);
    });
    (0, node_test_1.it)('matches IDs with dots and hyphens', () => {
        const body = 'See [[module.auth_service]], [[decision.jwt_tokens]], and [[feature.user-login]].';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids.sort(), [
            'decision.jwt_tokens',
            'feature.user-login',
            'module.auth_service',
        ].sort());
    });
    (0, node_test_1.it)('matches IDs with underscores', () => {
        const body = 'Reference: [[test.my_card_id_v2]]';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, ['test.my_card_id_v2']);
    });
    (0, node_test_1.it)('only matches lowercase IDs (pmem id_pattern is lowercase)', () => {
        const body = 'Valid: [[character.zero]] Invalid: [[Character.Zero]] Also invalid: [[CHARACTER.ZERO]].';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        // Only the lowercase version matches per pmem id_pattern rules
        node_assert_1.default.deepStrictEqual(ids, ['character.zero']);
    });
    (0, node_test_1.it)('does not match invalid patterns', () => {
        const body = 'This is [not a wikilink] and (not one) and [[ also not one.';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, []);
    });
    (0, node_test_1.it)('does not match IDs starting with a digit', () => {
        // pmem card IDs must start with a letter
        const body = 'Invalid: [[123.bad]] but valid: [[card.ok]].';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, ['card.ok']);
    });
    (0, node_test_1.it)('returns empty array for body with no wikilinks', () => {
        const body = '## Just a heading\n\nSome paragraph text with **bold** and *italic*.\n\n- list item';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids, []);
    });
    (0, node_test_1.it)('returns empty array for empty body', () => {
        const ids = (0, rebuild_1.extractWikilinks)('');
        node_assert_1.default.deepStrictEqual(ids, []);
    });
    (0, node_test_1.it)('extracts wikilinks embedded in markdown', () => {
        const body = `## Chapter 1

- **POV character**: [[character.lin-zhixu]]
- **Setting**: [[world.shiyu]]
- See also: [[arc.main_plot]]

> "Quote from [[character.zero]]" — referenced in [[decision.plot_twist]]`;
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids.sort(), [
            'arc.main_plot',
            'character.lin-zhixu',
            'character.zero',
            'decision.plot_twist',
            'world.shiyu',
        ].sort());
    });
    (0, node_test_1.it)('handles wikilinks with numbers in the type part', () => {
        const body = 'Feature: [[v2.feature_name]] and [[module.v2_auth]].';
        const ids = (0, rebuild_1.extractWikilinks)(body);
        node_assert_1.default.deepStrictEqual(ids.sort(), ['module.v2_auth', 'v2.feature_name'].sort());
    });
});
//# sourceMappingURL=rebuild.test.js.map