import { describe, it, expect } from 'vitest';
import { IA_OCR_MIN_AGREEMENT, IA_OCR_DEFAULT_MIN_AGREEMENT, iaOcrMinAgreement } from '../../scripts/lib/ia-ocr-gate.mjs';

/**
 * Pins the per-language cutoff policy for the free IA OCR lane (#4790). These values are a
 * MEASURED policy (delivered-text CER by agreement band, one interior page per book), not a
 * constant to tune by feel: a change here should come with a re-run of
 * scripts/eval/ia-ocr-delivered-quality.mjs and an EXPERIMENTS.md entry. The test exists so a
 * casual edit of the table fails loudly instead of silently moving the quality/yield trade.
 */
describe('iaOcrMinAgreement', () => {
  it('lowers English and French to 0.80 (the 0.80–0.85 band delivers median ≤ 5% CER there)', () => {
    expect(iaOcrMinAgreement('English')).toEqual({ language: 'English', cutoff: 0.80, source: 'measured' });
    expect(iaOcrMinAgreement('French')).toEqual({ language: 'French', cutoff: 0.80, source: 'measured' });
  });

  it('keeps Latin, German and Italian at 0.85 (flat trade / Fraktur tail / n too small)', () => {
    for (const lang of ['Latin', 'German', 'Italian']) expect(iaOcrMinAgreement(lang).cutoff).toBe(0.85);
  });

  it('never fills Greek at any score', () => {
    expect(iaOcrMinAgreement('Greek')).toEqual({ language: 'Greek', cutoff: null, source: 'excluded' });
    expect(IA_OCR_MIN_AGREEMENT.Greek).toBeNull();
  });

  it('accepts any spelling the language normaliser accepts (codes, case, synonyms)', () => {
    expect(iaOcrMinAgreement('en').cutoff).toBe(0.80);
    expect(iaOcrMinAgreement('eng').cutoff).toBe(0.80);
    expect(iaOcrMinAgreement('english').cutoff).toBe(0.80);
    expect(iaOcrMinAgreement('grc').cutoff).toBeNull();
    expect(iaOcrMinAgreement('koine').cutoff).toBeNull();
    expect(iaOcrMinAgreement('lat').cutoff).toBe(0.85);
  });

  it('falls back to the historic 0.85 for languages that were never measured, and for no language', () => {
    expect(IA_OCR_DEFAULT_MIN_AGREEMENT).toBe(0.85);
    expect(iaOcrMinAgreement('Spanish')).toEqual({ language: 'Spanish', cutoff: 0.85, source: 'default' });
    expect(iaOcrMinAgreement('Dutch').source).toBe('default');
    expect(iaOcrMinAgreement(null)).toEqual({ language: null, cutoff: 0.85, source: 'default' });
    expect(iaOcrMinAgreement('').source).toBe('default');
    expect(iaOcrMinAgreement('N/A').source).toBe('default');
  });

  it('is a frozen table — nothing at a call site can edit the policy', () => {
    expect(Object.isFrozen(IA_OCR_MIN_AGREEMENT)).toBe(true);
    expect(() => { (IA_OCR_MIN_AGREEMENT as Record<string, number | null>).English = 0.5; }).toThrow();
  });
});
