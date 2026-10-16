import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper
import { syllableTokens, diffSyllables, yatagsHits, revertHits } from '../../scripts/lib/tibetan-yatags-guard.mjs';
// @ts-expect-error plain .mjs helper
import { ocrReadProblem } from '../../scripts/lib/cli-chatter.mjs';

// #6560 seq 23 shape: the leaf has མཚན་མ་མེད་པ, the corrector wrote the Derge spelling མྱེད.
const draft = 'མཚན་མ་མེད་པ་དང་། སྨོན་པ་མེད་པ་\n<leaf-break/>\nདམིགས་སུ་མེད་དོ། །བུང་བ';
const next = 'མཚན་མ་མྱེད་པ་དང་། སྨོན་པ་མེད་པ་\n<leaf-break/>\nདམྱིགས་སུ་མེད་དོ། །དྲུང་བ';

describe('tibetan ya-btags guard', () => {
  it('tokenises on tsheg, shad and whitespace and drops tag lines', () => {
    expect(syllableTokens(draft).map((t: { syl: string }) => t.syl)).toEqual(['མཚན', 'མ', 'མེད', 'པ', 'དང', 'སྨོན', 'པ', 'མེད', 'པ', 'དམིགས', 'སུ', 'མེད', 'དོ', 'བུང', 'བ']);
  });
  it('flags only changes that add or drop ྱ under མ', () => {
    const hits = yatagsHits(draft, next);
    expect(hits.map((h: { draft: string; next: string }) => `${h.draft}>${h.next}`)).toEqual(['མེད>མྱེད', 'དམིགས>དམྱིགས']);
    expect(diffSyllables(draft, next).changed).toBe(3); // the two ya-btags changes and བུང→དྲུང
  });
  it('flags a removal too', () => {
    expect(yatagsHits('མྱི་དགེ', 'མི་དགེ').length).toBe(1);
  });
  it('puts back every change not confirmed, and keeps the rest of the correction', () => {
    const hits = yatagsHits(draft, next);
    const out = revertHits(next, hits, new Set([hits[1].k]));
    expect(out).toBe('མཚན་མ་མེད་པ་དང་། སྨོན་པ་མེད་པ་\n<leaf-break/>\nདམྱིགས་སུ་མེད་དོ། །དྲུང་བ');
    expect(yatagsHits(draft, revertHits(next, hits, new Set())).length).toBe(0);
  });
});

describe('ocrReadProblem header option (#6560 correct mode)', () => {
  it('a plain Tibetan correction is not chatter when no header is expected', () => {
    expect(ocrReadProblem(next)).toBe('no <page-type> tag');
    expect(ocrReadProblem(next, { header: false })).toBeNull();
  });
});
