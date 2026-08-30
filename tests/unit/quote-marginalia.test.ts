/**
 * Marginalia detection on the quote path (#4362).
 *
 * A quote drawn from a `<margin>` block used to cite identically to body
 * text — but a marginal note exists in exactly ONE physical copy, so the
 * apparatus must flag it and point at the copy clause (#4360).
 */
import { describe, it, expect } from 'vitest';
import { containsMarginalia, MARGINALIA_NOTE } from '@/lib/quote-text';

describe('containsMarginalia', () => {
  it('detects the OCR tag form', () => {
    expect(containsMarginalia('Body text. <margin>Nota bene: mercurius</margin> More body.')).toBe(true);
    expect(containsMarginalia('<margin lang="la">gloss</margin>')).toBe(true);
  });

  it('detects the bracket form NotesRenderer also normalizes', () => {
    expect(containsMarginalia('Body. [[margin: a reader adds a cross here]]')).toBe(true);
  });

  it('stays quiet on plain body text', () => {
    expect(containsMarginalia('A page with no marginal apparatus at all.')).toBe(false);
    // The WORD "margin" is not the mark.
    expect(containsMarginalia('printed close to the margin of the leaf')).toBe(false);
    // Other real page marks are not marginalia.
    expect(containsMarginalia('<sig>B2r</sig> <page-num>28</page-num>')).toBe(false);
  });
});

describe('MARGINALIA_NOTE', () => {
  it('says the two things that matter: copy-specific, and cite the holder', () => {
    expect(MARGINALIA_NOTE).toContain('COPY-SPECIFIC');
    expect(MARGINALIA_NOTE).toContain('citation.copy');
    expect(MARGINALIA_NOTE).toContain('marginal annotation');
  });
});
