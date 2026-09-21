import { describe, it, expect } from 'vitest';
import {
  bodyLen,
  isTranslatablePage,
  isBlankFromOcr,
  isDegenerateSource,
  MIN_TRANSLATABLE_BODY,
} from '../../scripts/lib/translate-core.mjs';
import {
  translatableBodyLen,
  hasNoTranslatableBody,
  MIN_TRANSLATABLE_BODY as MIN_TS,
} from '../../src/lib/translate-write';

/**
 * A model handed an empty source does not decline. It invents.
 *
 * Page 170 of Kircher's *Iter extaticum II* (1657) is a blank leaf. Its OCR is 18,561
 * characters of `&nbsp;` padding around a folio number. Every length check in this
 * module counted those six-character entities as text, so the page presented as a
 * substantial source, went to the translator, and came back as:
 *
 *   "We are pleased to present the first issue of the Journal of the American Society
 *    of Nephrology (JASN) for 2011… 'Renal Denervation for the Treatment of Resistant
 *    Hypertension: A Randomized, Controlled Trial' by Dr. John Smith…"
 *
 * That shipped to readers in a q100 book and was one deposit away from a permanent
 * DOI (#4960).
 *
 * #4890 was the SAME input producing the opposite failure: handed nothing, the model
 * said "Please provide the Latin text" and we stored the refusal. We guarded that —
 * the loud branch. This is the silent one, from the identical cause.
 *
 * And the loop guard cannot cover it: `&nbsp;` padding was deliberately tuned OUT of
 * the repeat metric as its dominant false positive (164 of 181). Stripping apparatus
 * so a metric is not fooled by it, and then never asking whether anything REMAINS, is
 * the whole gap.
 */

/** The real page, reconstructed: a folio number adrift in entity padding. */
const KIRCHER_170 = `146 ${'&nbsp;'.repeat(3000)}`;

/** A page that genuinely has text on it. */
const REAL_PAGE =
  '<language>Latin</language><page-type>text</page-type>\n' +
  'Cosmiel. Quid est quod mireris, Theodidacte? An tantam de me opinionem concepisti…';

describe('bodyLen does not count entity padding as text', () => {
  it('the Kircher page measures a folio number, not 18,561 characters', () => {
    expect(KIRCHER_170.length).toBeGreaterThan(18000);
    expect(bodyLen(KIRCHER_170)).toBeLessThan(MIN_TRANSLATABLE_BODY);
  });

  it('every whitespace entity spelling collapses', () => {
    for (const e of ['&nbsp;', '&ensp;', '&emsp;', '&thinsp;', '&#160;', '&#xa0;', '&#8194;']) {
      expect(bodyLen(`ab${e.repeat(200)}cd`), e).toBeLessThan(10);
    }
  });

  it('a text entity counts as the one character it represents', () => {
    // `&amp;` is an ampersand, not five characters of body.
    expect(bodyLen('Hall &amp; Sons')).toBe('Hall & Sons'.length);
  });

  it('real prose is unaffected', () => {
    const b = bodyLen(REAL_PAGE);
    expect(b).toBeGreaterThan(60);
    expect(b).toBeLessThan(REAL_PAGE.length); // tags still stripped
  });
});

describe('isTranslatablePage refuses a source with nothing in it', () => {
  const page = (ocr: string) => ({ page_number: 170, ocr: { data: ocr } });

  it('refuses the Kircher page — the exhibit', () => {
    expect(isTranslatablePage(page(KIRCHER_170))).toEqual({ ok: false, reason: 'no-body' });
  });

  it('and the old guards really did all pass it — this is why the gap existed', () => {
    expect(isBlankFromOcr(KIRCHER_170)).toBe(false);
    expect(isDegenerateSource(KIRCHER_170)).toBe(false);
  });

  it('still translates a page that has text', () => {
    expect(isTranslatablePage(page(REAL_PAGE))).toEqual({ ok: true });
  });

  it('keeps a short but real chapter heading above the line', () => {
    // The threshold is asymmetric on purpose, but it must not eat real headings.
    const heading = '<page-type>text</page-type>CAPUT PRIMUM. De natura elementorum.';
    expect(bodyLen(heading)).toBeGreaterThanOrEqual(MIN_TRANSLATABLE_BODY);
    expect(isTranslatablePage(page(heading))).toEqual({ ok: true });
  });

  it('a page of leader dots is not a source either', () => {
    expect(isTranslatablePage(page(`12 ${'.'.repeat(400)} 34`)).ok).toBe(false);
  });
});

/**
 * The .mjs and .ts copies guard the SAME write path — the workers go through
 * `translate-core`, the two async batch routes through `translate-write`. A fix in one
 * that misses the other leaves the lane that actually produced the Kircher page open.
 */
describe('the .mjs and .ts twins agree', () => {
  it('same threshold', () => {
    expect(MIN_TS).toBe(MIN_TRANSLATABLE_BODY);
  });

  it('same verdict on every fixture', () => {
    const cases = [
      KIRCHER_170,
      REAL_PAGE,
      `12 ${'.'.repeat(400)} 34`,
      'Hall &amp; Sons',
      `ab${'&nbsp;'.repeat(200)}cd`,
      '',
      'CAPUT PRIMUM. De natura elementorum.',
    ];
    for (const c of cases) {
      expect(hasNoTranslatableBody(c), JSON.stringify(c.slice(0, 40))).toBe(
        bodyLen(c) < MIN_TRANSLATABLE_BODY,
      );
    }
  });

  it('the TS side measures the exhibit the same way', () => {
    expect(translatableBodyLen(KIRCHER_170)).toBeLessThan(MIN_TS);
    expect(translatableBodyLen(REAL_PAGE)).toBeGreaterThan(60);
  });
});
