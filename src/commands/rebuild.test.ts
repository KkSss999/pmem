import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractWikilinks } from '../commands/rebuild';

describe('extractWikilinks', () => {
  it('extracts a single [[card-id]] from body text', () => {
    const body = 'The protagonist [[character.zero]] enters the room.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('extracts multiple distinct [[card-id]] references', () => {
    const body = `## Scene

[[character.zero]] meets [[character.lin-zhixu]] at [[world.shiyu]].

They discuss the events of [[chapter.vol1]].`;
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'chapter.vol1',
      'character.lin-zhixu',
      'character.zero',
      'world.shiyu',
    ].sort());
  });

  it('deduplicates repeated references', () => {
    const body = '[[character.zero]] appears. Then [[character.zero]] speaks. [[character.zero]] leaves.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('matches IDs with dots and hyphens', () => {
    const body = 'See [[module.auth_service]], [[decision.jwt_tokens]], and [[feature.user-login]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'decision.jwt_tokens',
      'feature.user-login',
      'module.auth_service',
    ].sort());
  });

  it('matches IDs with underscores', () => {
    const body = 'Reference: [[test.my_card_id_v2]]';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['test.my_card_id_v2']);
  });

  it('only matches lowercase IDs (pmem id_pattern is lowercase)', () => {
    const body = 'Valid: [[character.zero]] Invalid: [[Character.Zero]] Also invalid: [[CHARACTER.ZERO]].';
    const ids = extractWikilinks(body);
    // Only the lowercase version matches per pmem id_pattern rules
    assert.deepStrictEqual(ids, ['character.zero']);
  });

  it('does not match invalid patterns', () => {
    const body = 'This is [not a wikilink] and (not one) and [[ also not one.';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, []);
  });

  it('does not match IDs starting with a digit', () => {
    // pmem card IDs must start with a letter
    const body = 'Invalid: [[123.bad]] but valid: [[card.ok]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, ['card.ok']);
  });

  it('returns empty array for body with no wikilinks', () => {
    const body = '## Just a heading\n\nSome paragraph text with **bold** and *italic*.\n\n- list item';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids, []);
  });

  it('returns empty array for empty body', () => {
    const ids = extractWikilinks('');
    assert.deepStrictEqual(ids, []);
  });

  it('extracts wikilinks embedded in markdown', () => {
    const body = `## Chapter 1

- **POV character**: [[character.lin-zhixu]]
- **Setting**: [[world.shiyu]]
- See also: [[arc.main_plot]]

> "Quote from [[character.zero]]" — referenced in [[decision.plot_twist]]`;
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), [
      'arc.main_plot',
      'character.lin-zhixu',
      'character.zero',
      'decision.plot_twist',
      'world.shiyu',
    ].sort());
  });

  it('handles wikilinks with numbers in the type part', () => {
    const body = 'Feature: [[v2.feature_name]] and [[module.v2_auth]].';
    const ids = extractWikilinks(body);
    assert.deepStrictEqual(ids.sort(), ['module.v2_auth', 'v2.feature_name'].sort());
  });
});
