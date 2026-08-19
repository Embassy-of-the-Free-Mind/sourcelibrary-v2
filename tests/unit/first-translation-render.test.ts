/**
 * ftRenderProps — the one render decision for badge surfaces (#3726 Tier 3).
 *
 * The invariant this suite pins (from first-translation-claims.md): a one-sided
 * check on a two-sided change is a coin flip you will read as a pass. So both
 * registers carry positive controls — a book that MUST assert, and books that
 * MUST NOT — over both payload shapes (Atlas doc and catalog row).
 */
import { describe, expect, it } from 'vitest';
import { ftRenderProps } from '@/lib/first-translation/render';
import type { FirstTranslation } from '@/lib/first-translation/types';

const strongVerdict = (over: Partial<FirstTranslation> = {}): FirstTranslation => ({
  verdict: 'first_no_prior',
  evidence_strength: 'strong',
  our_completeness: 'unknown',
  match_key: 'author_title',
  resolver: 'tier2_agent',
  ...over,
});

const atlasBook = (over: Record<string, unknown> = {}) => ({
  first_translation: strongVerdict(),
  visible: true,
  pages_translated: 100,
  language: 'Latin',
  ...over,
});

const catalogRow = (over: Record<string, unknown> = {}) => ({
  ft_verdict: 'first_no_prior',
  ft_evidence_strength: 'strong',
  ft_our_completeness: 'unknown',
  is_first_translation: true,
  pages_translated: 100,
  language: 'Latin',
  ...over,
});

describe('ftRenderProps — confirmed register (positive controls)', () => {
  it('asserts for a strong first_no_prior Atlas doc', () => {
    expect(ftRenderProps(atlasBook())).toEqual({
      claim: 'confirmed',
      disposition: 'confirmed_first',
    });
  });

  it('asserts for the same book seen through a catalog row', () => {
    expect(ftRenderProps(catalogRow())).toEqual({
      claim: 'confirmed',
      disposition: 'confirmed_first',
    });
  });

  it('moderate evidence also earns the register', () => {
    expect(ftRenderProps(catalogRow({ ft_evidence_strength: 'moderate' })).claim).toBe('confirmed');
  });

  it('maps verdict shades to label dispositions (from_source, modern)', () => {
    expect(
      ftRenderProps(atlasBook({ first_translation: strongVerdict({ verdict: 'first_from_source' }) }))
        .disposition,
    ).toBe('first_from_source');
    expect(ftRenderProps(catalogRow({ ft_verdict: 'first_modern' })).disposition).toBe(
      'first_modern_translation',
    );
  });

  it('first_complete asserts only when OUR item is complete', () => {
    expect(
      ftRenderProps(
        catalogRow({ ft_verdict: 'first_complete', ft_our_completeness: 'complete' }),
      ).claim,
    ).toBe('confirmed');
    expect(
      ftRenderProps(
        catalogRow({ ft_verdict: 'first_complete', ft_our_completeness: 'partial' }),
      ).claim,
    ).toBe('candidate');
  });
});

describe('ftRenderProps — candidate register (the fail-toward direction)', () => {
  it('weak evidence never asserts', () => {
    expect(ftRenderProps(catalogRow({ ft_evidence_strength: 'weak' })).claim).toBe('candidate');
  });

  it('a missing verdict never asserts, whatever the legacy disposition reads', () => {
    const r = ftRenderProps(
      catalogRow({ ft_verdict: null, ft_evidence_strength: null, ft_disposition: 'confirmed_first' }),
    );
    expect(r.claim).toBe('candidate');
    // Legacy disposition still flows through for surfaces that shade on it.
    expect(r.disposition).toBe('confirmed_first');
  });

  it('a not_first verdict never asserts (defeated collapses to candidate)', () => {
    expect(ftRenderProps(catalogRow({ ft_verdict: 'not_first' })).claim).toBe('candidate');
  });

  it('an english-source screen defeats assertion even over a strong verdict', () => {
    expect(ftRenderProps(catalogRow({ ft_source_screen: 'english_source' })).claim).toBe(
      'candidate',
    );
  });

  it('a translator-screen hold defeats assertion (review, not exclusion)', () => {
    expect(ftRenderProps(catalogRow({ ft_translator_screen: 'hold' })).claim).toBe('candidate');
  });

  it('zero translated pages fails the render gate', () => {
    expect(ftRenderProps(catalogRow({ pages_translated: 0 })).claim).toBe('candidate');
  });

  it('an Atlas legacy-only book (no verdict object) is candidate with its legacy shade', () => {
    const r = ftRenderProps(
      atlasBook({
        first_translation: null,
        translation_verification: { disposition: 'first_modern_translation' },
      }),
    );
    expect(r.claim).toBe('candidate');
    expect(r.disposition).toBe('first_modern_translation');
  });

  it('an empty payload is candidate with no disposition', () => {
    expect(ftRenderProps({})).toEqual({ claim: 'candidate', disposition: undefined });
  });
});
