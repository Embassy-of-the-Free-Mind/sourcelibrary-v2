/**
 * The reader-facing band (#7263): the two middle grades merged and split on the count of serious spans.
 * Pins the boundary (2 vs 3), that cosmetic slips never count, that gradeOf() keeps its keys, and that
 * the grades outside the middle pass through unchanged.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no types
import { bandOf, gradeOf, GRADES, BANDS, seriousSpans } from '../../scripts/eval/confidence-7866/regrade.mjs';

const d = (severity: string, cls = 'O6') => ({ class: cls, severity, quote: 'x', what: 'y' });
const v = (defects: object[], fidelity = 3) => ({ accept: false, fidelity, defects });

describe('bandOf', () => {
  it('2 serious spans are some_errors, 3 are many_errors', () => {
    expect(bandOf(v([d('misleads'), d('misleads')]))).toBe('some_errors');
    expect(bandOf(v([d('misleads'), d('misleads'), d('misleads')]))).toBe('many_errors');
  });

  it('counts misleads and wrong_text together, across the old search_only / wrong_span line', () => {
    const two = v([d('misleads'), d('wrong_text', 'O7')]);
    expect(gradeOf(two)).toBe('wrong_span');
    expect(bandOf(two)).toBe('some_errors');
    const three = v([d('misleads'), d('wrong_text', 'O7'), d('misleads')]);
    expect(bandOf(three)).toBe('many_errors');
    expect(bandOf(v([d('misleads')]))).toBe('some_errors');
  });

  it('cosmetic slips never count toward the band', () => {
    const slips = v([d('cosmetic'), d('cosmetic'), d('cosmetic'), d('cosmetic')]);
    expect(seriousSpans(slips)).toBe(0);
    expect(bandOf(slips)).toBe('fit_to_read');
    expect(bandOf(v([d('cosmetic')]))).toBe('fit_to_quote');
    expect(bandOf(v([d('misleads'), d('misleads'), d('cosmetic'), d('cosmetic'), d('cosmetic')]))).toBe('some_errors');
  });

  it('from_elsewhere stays out of the middle, however many spans it has', () => {
    expect(bandOf(v([d('wrong_text', 'O1')]))).toBe('from_elsewhere');
    expect(bandOf(v([d('wrong_text', 'I1'), d('misleads'), d('misleads'), d('misleads')]))).toBe('from_elsewhere');
  });

  it('mostly_wrong and not_this_page pass through on fidelity', () => {
    expect(bandOf(v([d('misleads'), d('misleads'), d('misleads')], 2))).toBe('mostly_wrong');
    expect(bandOf(v([], 1))).toBe('not_this_page');
  });

  it('gradeOf keeps its keys; BANDS replaces only the middle two', () => {
    expect(GRADES).toEqual(['fit_to_quote', 'fit_to_read', 'search_only', 'wrong_span', 'from_elsewhere', 'mostly_wrong', 'not_this_page']);
    expect(BANDS.filter((k: string) => !GRADES.includes(k))).toEqual(['some_errors', 'many_errors']);
    expect(GRADES.filter((k: string) => !BANDS.includes(k))).toEqual(['search_only', 'wrong_span']);
  });
});
