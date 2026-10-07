/**
 * The RECITATION retry tier asks for the printed long s and stores it as s (#5521).
 *
 * Pins three properties the tier depends on: the fold leaves no ſ (the house convention, v16 never outputs
 * ſ), the line is sited at its anchor or refuses (an appended line is not the measured intervention), and
 * it is sent only for Latin-script books.
 */
import { describe, it, expect } from 'vitest';
import {
  foldLongS,
  withLongSLine,
  longSRetryApplies,
  LONG_S_ANCHOR,
  LONG_S_LINE,
  // @ts-expect-error — plain .mjs module without type declarations
} from '../../scripts/lib/ocr-long-s-retry.mjs';

describe('long-s retry', () => {
  it('folds every long s back to s', () => {
    expect(foldLongS('Of the ſeuerall ſorts of muſt and ſhall')).toBe('Of the seuerall sorts of must and shall');
    expect(foldLongS('no long s here')).toBe('no long s here');
    expect(foldLongS(null)).toBe('');
  });

  it('sites the line before the anchor, once', () => {
    const prompt = `intro\n\n${LONG_S_ANCHOR}\nrules`;
    const out = withLongSLine(prompt);
    expect(out.indexOf(LONG_S_LINE)).toBeGreaterThan(-1);
    expect(out.indexOf(LONG_S_LINE)).toBeLessThan(out.indexOf(LONG_S_ANCHOR));
    expect(out.split(LONG_S_LINE).length).toBe(2);
  });

  it('refuses when the anchor is gone instead of appending', () => {
    expect(() => withLongSLine('a prompt without the anchor')).toThrow(/anchor/);
  });

  it('applies to Latin-script books only', () => {
    for (const l of ['Latin', 'English', 'German', 'la, de', 'French']) expect(longSRetryApplies({ language: l })).toBe(true);
    for (const l of ['Greek', 'Hebrew', 'Chinese', 'Arabic', 'Syriac', '', undefined]) expect(longSRetryApplies({ language: l })).toBe(false);
  });
});
