import { describe, it, expect } from 'vitest';
import { frontMatterVerdict, isFrontMatter } from '@/lib/front-matter';

// Shapes below are taken from real OCR on the two books in the report: the
// Taylor 1801 Metaphysics (which HAS a long introduction) and the Bekker 1831
// volume (which has none). The distinction between them is the whole point.

const TAYLOR_INTRO_PAGE =
  '<page-type>text</page-type>\n<header>INTRODUCTION.</header>\n<page-num>xxiii</page-num>\n' +
  'Since, then, the philosophy of Aristotle is thus arranged, it is necessary to observe that the whole of his doctrine concerning being qua being is contained in these books, and that the translator has endeavoured to render them faithfully.';

const TAYLOR_BODY_PAGE =
  '<page-type>text</page-type>\n<header>METAPHYSICS.</header>\n<page-num>264</page-num>\n' +
  'All men naturally desire to know, and an indication of this is the delight we take in the senses; for even apart from their usefulness they are loved for themselves.';

// The trap: the SAME continuous introduction is typed `text` on most pages and
// `preface` on a scattered few, so page-type cannot be the signal.
const TAYLOR_INTRO_TAGGED_PREFACE =
  '<page-type>preface</page-type>\n<header>INTRODUCTION.</header>\n<page-num>xxv</page-num>\nideas. That Aristotle was not ignorant of this doctrine is evident.';

describe('frontMatterVerdict', () => {
  it('catches front matter by the printer\'s own roman pagination', () => {
    const v = frontMatterVerdict(TAYLOR_INTRO_PAGE);
    expect(v.is_front_matter).toBe(true);
    expect(v.reason).toBe('roman-pagination');
  });

  it('catches it by the running head when the number is missing', () => {
    const v = frontMatterVerdict('<header>PREFACE</header>\nThe editor begs leave to observe.');
    expect(v.is_front_matter).toBe(true);
    expect(v.reason).toBe('structural-header');
  });

  it('leaves the body alone', () => {
    expect(isFrontMatter(TAYLOR_BODY_PAGE)).toBe(false);
  });

  // The reason page-type is not consulted at all.
  it('does not depend on page-type, which is inconsistent on this very book', () => {
    expect(isFrontMatter(TAYLOR_INTRO_TAGGED_PREFACE)).toBe(true);
    // ...and a body page mistyped as preface must NOT be demoted on that basis.
    const mistyped = '<page-type>preface</page-type>\n<header>METAPHYSICS.</header>\n<page-num>301</page-num>\nbody text here';
    expect(isFrontMatter(mistyped)).toBe(false);
  });

  // The failure mode that made a positional rule unusable: the Bekker volume's
  // body starts on scan page 7 and it has NO front matter. A "first 60 pages"
  // rule would bury 50+ pages of genuine Aristotle.
  it('stays silent on a book with no front matter', () => {
    const bekkerEarly = '<page-type>text</page-type>\n<header>ΗΘΙΚΩΝ ΝΙΚΟΜΑΧΕΙΩΝ</header>\n<page-num>1094</page-num>\nπᾶσα τέχνη καὶ πᾶσα μέθοδος';
    expect(isFrontMatter(bekkerEarly)).toBe(false);
  });

  it('does not mistake a stray single letter for a roman numeral', () => {
    // Signature marks ("b", "C", "d 2") sit where a page number would, and a
    // bare "i" or "c" is far more often one of those than a real numeral.
    for (const n of ['i', 'c', 'd', 'l', 'm']) {
      expect(isFrontMatter(`<page-num>${n}</page-num>\nbody text`), n).toBe(false);
    }
    // ...but unambiguous short numerals still count.
    expect(isFrontMatter('<page-num>v</page-num>\ntext')).toBe(true);
    expect(isFrontMatter('<page-num>ix</page-num>\ntext')).toBe(true);
  });

  it('does not fire on a header that merely mentions a topic', () => {
    // "INDEX" as a running head is structural; a body page discussing an index
    // of refraction is not, and the header is where the distinction lives.
    expect(isFrontMatter('<header>OPTICKS.</header>\n<page-num>42</page-num>\nthe index of refraction is greater')).toBe(false);
  });

  it('defaults to body when there is no evidence at all', () => {
    expect(isFrontMatter('just some text with no tags')).toBe(false);
    expect(isFrontMatter('')).toBe(false);
    expect(isFrontMatter(null)).toBe(false);
    expect(isFrontMatter(undefined)).toBe(false);
  });
});
