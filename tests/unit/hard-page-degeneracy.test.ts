import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs eval script, no type declarations
import { loopCoverage, entityPadRatio, isDegenerate, LOOP_THRESHOLD } from '../../scripts/eval/hard-page-sample.mjs';

/**
 * These exercise the detector; they do not assert that source text contains a
 * string. The failure this guards is a real one that already happened: the
 * first version of the degeneracy metric used a whitespace type/token ratio and
 * flagged ~20% of space-less-script pages (Tibetan, Devanagari, Javanese) as
 * "degenerate" purely because whitespace tokenisation is meaningless for them.
 * A second version reported "coverage" above 1.0 by counting overlapping tiles.
 */
describe('hard-page degeneracy detector', () => {
  const latin =
    'Quod si quis putaverit hanc rem esse levem atque contemnendam, is profecto ' +
    'errat vehementer, nam in his ipsis rebus maxima saepe momenta versantur, ' +
    'ut docet experientia cotidiana rerum humanarum atque naturae ipsius ordo. ' +
    'Neque enim aliter fieri potest quin ea quae sensibus percipiuntur ratione ' +
    'quoque confirmentur, cum utrumque ad veritatem investigandam pertineat.';

  it('reports coverage as a true fraction, never above 1', () => {
    for (const t of [latin, 'ab'.repeat(2000), 'x'.repeat(1000)]) {
      const c = loopCoverage(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('catches a repetition loop', () => {
    // The real failure mode: one unit tiling the whole page.
    const loop = 'तत्रैव तत्रैव तत्रैव '.repeat(300);
    expect(loopCoverage(loop)).toBeGreaterThanOrEqual(LOOP_THRESHOLD);
    expect(isDegenerate(loop)).toBe(true);
  });

  it('does NOT flag ordinary prose', () => {
    // Must be genuinely varied: `latin.repeat(3)` is itself a repetition and
    // the detector correctly flags it — the first version of this test used
    // that and failed, which was the fixture's fault, not the detector's.
    const page = latin +
      ' Atque haec quidem de rebus naturalibus dicta sunt, nunc ad ea transeamus ' +
      'quae ad mores atque instituta civitatis pertinent, in quibus non minor ' +
      'diligentia adhibenda est quam in illis quae ad caelum spectant. ' +
      'Constat enim inter omnes prudentes viros nihil esse praestabilius quam ' +
      'iustitiam colere, fidem servare, beneficiis erga alios abundare, atque ' +
      'in adversis rebus animum firmum atque constantem praestare semper.';
    expect(loopCoverage(page)).toBeLessThan(LOOP_THRESHOLD);
    expect(isDegenerate(page)).toBe(false);
  });

  it('does NOT flag space-less script text merely for lacking spaces', () => {
    // Varied Tibetan — no repeated unit. The old word-TTR rule flagged this
    // class wholesale; this is the negative control for that regression.
    const tibetan =
      '༄༅།།ལས་བཞིའི་འཕྲིན་ལས་ཀྱི་རིམ་པ་རྣམས་ཀྱང་།རང་རང་གི་ལྷ་ཚོགས་ཀྱི་བསྐྱེད་རིམ་དང་།' +
      'དེ་ནས་རྗེས་སུ་ཡི་རང་བར་བྱའོ།།འཁོར་དེ་དག་གིས་བཅོམ་ལྡན་འདས་ལ་ཕྱག་འཚལ་ནས།' +
      'རྡོ་རྗེ་སྙིང་པོ་ལ་སོགས་པ།དགེ་བའི་རྩ་བ་ཡོངས་སུ་བསྔོ་བར་བྱེད་དོ།།ཞེས་གསུངས་སོ།།' +
      'བྱང་ཆུབ་སེམས་དཔའ་སེམས་དཔའ་ཆེན་པོ་རྣམས་ཀྱིས་ཀྱང་དེ་བཞིན་དུ་མཐའ་ཡས་པར་བཤད།';
    expect(isDegenerate(tibetan)).toBe(false);
  });

  it('catches HTML-entity padding', () => {
    const padded = '&nbsp;'.repeat(4000) + ' actual words here on the page';
    expect(entityPadRatio(padded)).toBeGreaterThan(0.5);
    expect(isDegenerate(padded)).toBe(true);
  });

  it('ignores text too short to judge', () => {
    expect(loopCoverage('short')).toBe(0);
    expect(isDegenerate('short')).toBe(false);
  });
});
