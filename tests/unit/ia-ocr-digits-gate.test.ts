/**
 * The IA lane's digits gate (#5186): numeric agreement (scripts/lib/ia-ocr-agreement.mjs) and its
 * policy (scripts/lib/ia-ocr-gate.mjs). Pins that a silent digit swap (1836 → 1886, the Deyo 3→8
 * class) and a digit read as a letter (551 → SSI) count as misses, that the folio is not a number
 * to judge (the Archive drops margin folios; that is furniture, not digits), and that the policy
 * line separates the measured books (Deyo 0.958 on its sample → unreliable; NH Notables 0.986 → not).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { numericAgreement, pageNumberCounts } from '../../scripts/lib/ia-ocr-agreement.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { iaOcrDigitsVerdict, IA_OCR_MIN_NUMERIC_AGREEMENT, IA_OCR_MIN_REF_NUMBERS } from '../../scripts/lib/ia-ocr-gate.mjs';

const MODEL = '<page-num>175</page-num>\n<header>THE SOCIETY OF FRIENDS. 175</header>\n\nIn 1836 a clergyman of Roxbury, born 1688, preached in the year 551.\n<vocab>Roxbury 1836</vocab>';

describe('numericAgreement', () => {
  it('scores identical numbers as full agreement, folio excluded on both sides', () => {
    const ia = 'THE SOCIETY OF FRIENDS. 175\n\nIn 1836 a clergyman of Roxbury, born 1688, preached in the year 551.';
    expect(numericAgreement(MODEL, ia)).toEqual({ ref: 3, matched: 3 });
  });

  it('counts a silent swap and a digit read as a letter as misses', () => {
    const ia = 'THE SOCIETY OF FRIENDS. 175\n\nIn 1886 a clergyman of Roxbury, born 1688, preached in the year SSI.';
    expect(numericAgreement(MODEL, ia)).toEqual({ ref: 3, matched: 1 });
  });

  it('does not penalise an Archive leaf that dropped the margin folio', () => {
    const ia = 'THE SOCIETY OF FRIENDS.\n\nIn 1836 a clergyman of Roxbury, born 1688, preached in the year 551.';
    expect(numericAgreement(MODEL, ia)).toEqual({ ref: 3, matched: 3 });
  });

  it('ignores the model\'s editorial blocks and single digits', () => {
    expect([...pageNumberCounts('<vocab>1836 1999</vocab>\nThe twelve were sent out in chapter 3, and 12 of them came home again that winter.', true).entries()]).toEqual([['12', 1]]);
  });

  it('treats an edge folio on Archive text as the folio, not a number', () => {
    expect([...pageNumberCounts('12 HISTORY OF THE COUNTY.\nborn 1836').entries()]).toEqual([['1836', 1]]);
  });
});

describe('iaOcrDigitsVerdict', () => {
  it('flags the measured bad books and passes the good ones', () => {
    expect(IA_OCR_MIN_NUMERIC_AGREEMENT).toBe(0.97);
    expect(iaOcrDigitsVerdict({ ref: 384, matched: 368 }).unreliable).toBe(true);   // Deyo sample 0.958
    expect(iaOcrDigitsVerdict({ ref: 441, matched: 418 }).unreliable).toBe(true);   // Gate City sample 0.948
    expect(iaOcrDigitsVerdict({ ref: 921, matched: 908 }).unreliable).toBe(false);  // NH Notables sample 0.986
  });

  it('judges on the unrounded share (0.9695 is below 0.97)', () => {
    expect(iaOcrDigitsVerdict({ ref: 2000, matched: 1939 })).toMatchObject({ ratio: 0.97, unreliable: true });
  });

  it('abstains on a book with too few numbers to judge', () => {
    expect(iaOcrDigitsVerdict({ ref: IA_OCR_MIN_REF_NUMBERS - 1, matched: 0 })).toMatchObject({ ratio: null, unreliable: false });
    expect(iaOcrDigitsVerdict()).toMatchObject({ ratio: null, ref: 0, unreliable: false });
  });
});
