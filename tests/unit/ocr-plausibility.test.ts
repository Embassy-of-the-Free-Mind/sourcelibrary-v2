/**
 * Page-level plausibility for the free OCR lane (#4784). Pins the one case it is built for
 * (a script switch that the book-level gate cannot see), the two abstentions, and the fact that
 * a reference too small to judge by abstains instead of refusing.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { letterTrigrams, referenceTrigramSet, pagePlausibility, isImplausible, DEFAULT_MIN_PLAUSIBILITY, MIN_REF_TRIGRAMS } from '../../scripts/lib/ocr-plausibility.mjs';

// Three real IA pages (public domain, from the #4780 hand-graded sample) — the smallest reference
// the ingester will calibrate on — and a fourth readable page from a different book as the probe.
import fixture from '../fixtures/ocr-plausibility-pages.json';
const REFERENCE: string[] = fixture.reference.map((p: { text: string }) => p.text);
const READABLE: string = fixture.readable.text;

describe('pagePlausibility', () => {
  const ref = referenceTrigramSet(REFERENCE);

  it('the test reference is at least as large as the smallest reference the ingester calibrates on', () => {
    expect(ref.size).toBeGreaterThanOrEqual(MIN_REF_TRIGRAMS);
  });

  it('scores readable prose of the same book well above the cut', () => {
    const { share } = pagePlausibility(READABLE, ref);
    expect(share).toBeGreaterThan(DEFAULT_MIN_PLAUSIBILITY + 0.2);
  });

  it('scores a Devanagari leaf read as Latin junk far below the cut (#4784 instance 1)', () => {
    const junk = "STf^3£*TCT%*ir<f ct: kgg'7^ f<p^ I rWT fq^fqqraTqTqif^q ??jm, | qfvRq?% WZ®S%SH S^RTqf^ WT- ?iotrI i fffw-qwTWFt foqf sfcrt 7m qifqq: ^s4 qf^qqfa: I %ft f| ft^jq JJft f#r WI: sfq sjfrwg^q f%gf#TFqftq qfeq FFTFrfwnFq Et5ii 5rto i 3T^i i\\^ Ficq^Tgrq- ^TT5PRk?R^RR^Rtf%f^l4: I q^rcfoiqftqfq:, ffir i qigR&q qt stm% q^qqqq q § wn«Fqfg&q";
    const { share, trigrams } = pagePlausibility(junk, ref);
    expect(trigrams).toBeGreaterThanOrEqual(40);
    expect(share).toBeLessThan(DEFAULT_MIN_PLAUSIBILITY - 0.2);
    expect(isImplausible(junk, ref)).toBe(true);
  });

  it('abstains on a page too short to judge', () => {
    expect(pagePlausibility('PLATE XII', ref).share).toBeNull();
    expect(isImplausible('PLATE XII', ref)).toBe(false);
  });

  it('abstains, never refuses, when the reference is too small to judge by', () => {
    const tiny = referenceTrigramSet([REFERENCE[0].slice(0, 300)]);
    expect(tiny.size).toBeLessThan(MIN_REF_TRIGRAMS);
    expect(pagePlausibility(READABLE, tiny).share).toBeNull();
    expect(isImplausible(READABLE, tiny)).toBe(false);
  });

  it('strips tags and folds case before counting', () => {
    expect(letterTrigrams('<header>The ROAD</header>')).toEqual(['the', 'roa', 'oad']);
  });
});
