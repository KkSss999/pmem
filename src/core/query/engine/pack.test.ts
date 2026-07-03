import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pack, estimateTokens } from './pack';

describe('v0.8 budget packer', () => {
  it('never trims L0 even when budget is tiny', () => {
    const result = pack({
      l0: ['PROJECT: x', 'FOCUS: y', 'NEXT: z'],
      l1: ['L1 long context'],
      l2: [{ id: 'card.a', title: 'A', summary: 'very long summary '.repeat(50), file_path: 'a.md' }],
      l3: ['a.md', 'b.md'],
    }, { budget: 1 });
    assert.ok(result.lines.includes('PROJECT: x'));
    assert.ok(result.lines.includes('FOCUS: y'));
    assert.ok(result.lines.includes('NEXT: z'));
  });

  it('brief mode drops L2 by design', () => {
    const result = pack({
      l0: ['PROJECT: x'],
      l1: [],
      l2: [{ id: 'card.a', title: 'A', summary: 'summary', file_path: 'a.md' }],
      l3: ['a.md'],
    }, { budget: 1000, mode: 'brief' });
    assert.ok(!result.lines.join('\n').includes('card.a'));
    assert.strictEqual(result.dropped_l2, 1);
  });

  it('estimates CJK as denser tokens than ASCII', () => {
    assert.ok(estimateTokens('混合检索') >= 4);
    assert.ok(estimateTokens('hybrid recall') < 'hybrid recall'.length);
  });
});
