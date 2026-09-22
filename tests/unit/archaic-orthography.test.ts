/**
 * The archaic-orthography detector decides where a modernization is worth offering.
 *
 * It replaces an EDITION-YEAR proxy (#4958): the reader used to make modernized text
 * the default view below 1820 and offer nothing at or above it. A date misses in both
 * directions — long ſ left English printing unevenly between roughly 1790 and 1810,
 * and antiquarian reprints set archaic type long afterwards.
 *
 * MEASURED against the live corpus on 2026-09-21, interior pages only, pages under 40
 * words skipped:
 *
 *   1622 A christian and heavenly treatise   94% of pages archaic
 *   1652 Theatrum Chemicum Britannicum       28%
 *   1671 Philosophia pia                     13%
 *   1618 Atalanta Fugiens                     1%   (mostly Latin/German emblem verse)
 *   1901 Apollonius of Tyana (Mead)           0%
 *   1903 Did Jesus Live 100 B.C.? (Mead)      0%
 *   1907 The Mysteries of Mithra (Mead)       0%
 *
 * Two things that run came back with, both encoded below:
 *
 * 1. A single marker is noise. An earlier density-only rule flagged one page of the
 *    1901 Apollonius on ONE hit, because a ~240-word page needs just one marker to
 *    clear 2-per-1000 — and the likeliest single hit (`fame`, `fuch`, `ufe`) is also
 *    the commonest f/s OCR slip in books of any period. Hence MIN_STRONG_MARKERS.
 *
 * 2. Our OCR is inconsistent about preserving long ſ WITHIN one book: the 1652
 *    Theatrum has 2,080 of them but only 28% of pages carry any. So the verdict is
 *    per PAGE, never per book — on a page where the glyph was normalised away there
 *    is nothing to modernize, and on the next page there is.
 */
import { describe, it, expect } from 'vitest';
import { readArchaicOrthography, isArchaicOrthography } from '@/lib/archaic-orthography';

/**
 * Pads a sample past the 40-word minimum without diluting it below the density
 * threshold. Six repetitions is ~48 filler words — comfortably over the floor, far
 * under the ~2,000 words at which a handful of markers would stop registering.
 */
const pad = (s: string) => `${s} ${'filler words to clear the minimum sample length '.repeat(6)}`;

describe('readArchaicOrthography', () => {
  it('any long s at all is decisive, whatever the page length', () => {
    const r = readArchaicOrthography('the moſt excellent');
    expect(r.longS).toBe(1);
    expect(r.archaic).toBe(true);
  });

  it('flags letterform swaps that modern English never uses', () => {
    const r = readArchaicOrthography(pad('he did giue vnto them, and loue euery one'));
    expect(r.swapped).toBeGreaterThanOrEqual(4);
    expect(r.archaic).toBe(true);
  });

  it('flags f-for-long-s misreads — archaic type through a transcriber lacking the glyph', () => {
    const r = readArchaicOrthography(pad('thefe are the moft juft and firft caufes'));
    expect(r.misreads).toBeGreaterThanOrEqual(4);
    expect(r.archaic).toBe(true);
  });

  it('a single stray marker is an OCR slip, not a typesetter', () => {
    // The 1901 Apollonius false positive, exactly.
    const r = readArchaicOrthography(pad('the fame conclusion follows from the argument above'));
    expect(r.misreads).toBe(1);
    expect(r.archaic).toBe(false);
  });

  it('archaic GRAMMAR is not archaic orthography — a modern book may quote scripture', () => {
    // The detector-artifact trap: a 1903 study of the Talmud quotes the Authorised
    // Version constantly. Perfectly legible, nothing to modernize.
    const r = readArchaicOrthography(
      pad('he hath said unto them, thou doest know that ye saith it, and thee also')
    );
    expect(r.archaic).toBe(false);
  });

  it('ignores apparatus tags and their contents', () => {
    // <vocab> and friends are our own markup; their CONTENTS are not the page's words.
    // Same artifact that once made a folio detector read "100" out of a vocab list.
    const withTags = '<vocab>vnto, haue, giue, euery</vocab><header>A TREATISE</header>' + pad('a perfectly ordinary modern sentence here');
    expect(readArchaicOrthography(withTags).swapped).toBe(0);
    expect(readArchaicOrthography(withTags).archaic).toBe(false);
  });

  it('is silent on empty, short, and missing text', () => {
    expect(readArchaicOrthography(null).archaic).toBe(false);
    expect(readArchaicOrthography(undefined).archaic).toBe(false);
    expect(readArchaicOrthography('').archaic).toBe(false);
    // Short page: three markers but far too little text to judge.
    expect(readArchaicOrthography('thefe moft juft').archaic).toBe(false);
  });

  it('modern prose is clean', () => {
    const r = readArchaicOrthography(
      pad('It is of interest to remark that this scheme was adopted as a means of ritual practice.')
    );
    expect(r.longS).toBe(0);
    expect(r.swapped).toBe(0);
    expect(r.archaic).toBe(false);
  });

  it('isArchaicOrthography agrees with the full reading', () => {
    expect(isArchaicOrthography('the moſt excellent')).toBe(true);
    expect(isArchaicOrthography(pad('an ordinary modern sentence'))).toBe(false);
  });
});
