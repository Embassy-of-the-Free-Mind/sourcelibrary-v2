import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs module without types
import { repairDigits, isNumberToken, splitToken, plainGlm } from '../../scripts/lib/glm-digit-repair.mjs';

/**
 * The digit repair for the Kraken refusal lane (#4686) takes GLM-OCR's NUMBERS into Kraken's text and
 * nothing else. These pin that: the measured misreads are fixed, GLM's words never enter, and what GLM
 * does not have (running heads, page numbers) stays as Kraken read it.
 */
describe('glm-digit-repair', () => {
  it('fixes the old-style figures Kraken read as letters (the eval misses)', () => {
    const k = 'whoſe angle is about cé or éy degrees, or (if he will) a little\nThe Pit is about io. foot ſquare, the ſides';
    const g = 'whose angle is about 66 or 67 degrees, or (if he will) a little\nThe Pit is about 10. foot square, the sides';
    const r = repairDigits(k, g);
    expect(r.text).toBe('whoſe angle is about 66 or 67 degrees, or (if he will) a little\nThe Pit is about 10. foot ſquare, the ſides');
    expect(r.changes.map((c: { from: string; to: string }) => `${c.from}>${c.to}`)).toEqual(['cé>66', 'éy>67', 'io.>10.']);
  });

  it('keeps Kraken\'s letters, long s and punctuation where GLM disagrees on words', () => {
    const k = 'the gentle ſleepe of the Moon';
    const g = 'the gentle fleece of the Moon';
    expect(repairDigits(k, g).text).toBe(k);
  });

  it('never imports a number for a spelled number or a numeral', () => {
    expect(repairDigits('the ten men came', 'the 10 men came').text).toBe('the ten men came');
    expect(repairDigits('chap. iii. of', 'chap. 3. of').text).toBe('chap. iii. of');
  });

  it('keeps lines GLM dropped (running head, page number) as Kraken read them', () => {
    const k = '( 931 )\nthe Pit is about io. foot';
    const r = repairDigits(k, 'the Pit is about 10. foot');
    expect(r.text).toBe('( 931 )\nthe Pit is about 10. foot');
  });

  it('reads GLM LaTeX degrees as the degree sign', () => {
    expect(plainGlm('$5^{\\circ}$. De')).toBe('5°. De');
    expect(repairDigits('“ g°. De meteororum', '" $5^{\\circ}$. De meteororum').text).toBe('“ 5°. De meteororum');
  });

  it('replaces a short unequal gap only when GLM gives numbers there', () => {
    expect(repairDigits('hora 2. 2 2 quanquam', 'hora 2. 22 quanquam').text).toBe('hora 2. 22 quanquam');
    expect(repairDigits('hora long word quanquam', 'hora 22 quanquam').text).toBe('hora long word quanquam');
  });

  it('returns Kraken unchanged when GLM is empty', () => {
    expect(repairDigits('io. foot', '')).toEqual({ text: 'io. foot', changes: [] });
  });

  it('token helpers', () => {
    expect(splitToken('(5°.)')).toEqual({ lead: '(', core: '5', trail: '°.)' });
    expect(isNumberToken('5th')).toBe(true);
    expect(isNumberToken('2½')).toBe(true);
    expect(isNumberToken('degrees')).toBe(false);
  });
});
