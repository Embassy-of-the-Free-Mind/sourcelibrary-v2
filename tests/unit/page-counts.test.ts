/**
 * Page-count convention guard (issue #3293).
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only —
 * they count pages with `page_number > 0`. Pages with `page_number <= 0` are
 * a deliberate soft-hide and never render, so "N scans", the ≥90%-readable
 * filter, and the <5% "not yet translated" gate all assume the counters
 * exclude them. Every counter writer (batch collectors, split worker,
 * realtime translate) routes through scripts/lib/page-counts.mjs so the
 * convention can't drift per-writer again.
 *
 * The damage this pins against: histoire-de-la-magie-...-constant stored
 * pages_translated: 20 (all-pages counter with hidden pages) while 581 of 620
 * visible pages were translated, wrongly banner-ing "not yet translated".
 */
import { describe, it, expect } from 'vitest';

import {
  VISIBLE_PAGE_MATCH,
  isVisiblePage,
  hasOcr,
  hasTranslation,
  isBlankPage,
  isTranslatedPage,
  buildVisiblePageCountPipeline,
  countVisiblePageStats,
  NEVER_TRANSLATED_PAGE_TYPES as NEVER_TRANSLATED_MJS,
  isTextFreeIllustration,
  stripIllustrationBoilerplate,
  isTranslatablePageForCount,
} from '../../scripts/lib/page-counts.mjs';
import { NEVER_TRANSLATED_PAGE_TYPES as NEVER_TRANSLATED_TS } from '../../src/lib/page-counts';

describe('page-counts convention (#3293)', () => {
  it('VISIBLE_PAGE_MATCH selects only page_number > 0', () => {
    expect(VISIBLE_PAGE_MATCH).toEqual({ page_number: { $gt: 0 } });
  });

  it('isVisiblePage treats page_number <= 0 as hidden', () => {
    expect(isVisiblePage({ page_number: 1 })).toBe(true);
    expect(isVisiblePage({ page_number: 0 })).toBe(false);
    expect(isVisiblePage({ page_number: -3 })).toBe(false);
    expect(isVisiblePage({})).toBe(false);
    expect(isVisiblePage(null)).toBe(false);
  });

  it('hasOcr / hasTranslation require non-empty string data', () => {
    expect(hasOcr({ ocr: { data: 'text' } })).toBe(true);
    expect(hasOcr({ ocr: { data: '' } })).toBe(false);
    expect(hasOcr({ ocr: {} })).toBe(false);
    expect(hasOcr({})).toBe(false);
    expect(hasTranslation({ translation: { data: 'x' } })).toBe(true);
    expect(hasTranslation({ translation: { data: '' } })).toBe(false);
    expect(hasTranslation({})).toBe(false);
  });

  it('buildVisiblePageCountPipeline scopes the $match to book + visible pages', () => {
    const pipeline = buildVisiblePageCountPipeline('book-123');
    expect(pipeline[0]).toEqual({
      $match: { book_id: 'book-123', page_number: { $gt: 0 } },
    });
    // and it aggregates the three counters
    const group = pipeline[1].$group;
    expect(group.total).toEqual({ $sum: 1 });
    expect(group).toHaveProperty('with_ocr');
    expect(group).toHaveProperty('with_translation');
  });

  it('countVisiblePageStats excludes soft-hidden pages from every counter', () => {
    const pages = [
      { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
      { page_number: 2, ocr: { data: 'b' }, translation: { data: 'B' } },
      { page_number: 3, ocr: { data: 'c' } }, // ocr but no translation
      // soft-hidden pages: fully processed, but must NOT be counted
      { page_number: -1, ocr: { data: 'z' }, translation: { data: 'Z' } },
      { page_number: 0, ocr: { data: 'y' }, translation: { data: 'Y' } },
    ];
    expect(countVisiblePageStats(pages)).toEqual({
      total: 3,
      with_ocr: 3,
      with_translation: 2,
      // All three visible pages have OCR and none is a never-translated type,
      // so all three are translatable; two of them carry a translation.
      translatable: 3,
      translated_translatable: 2,
      blank: 0,
    });
  });

  it('translatable excludes what can never be translated, and its numerator matches', () => {
    // The #4442 denominator. A blank leaf carries a translation PLACEHOLDER, so
    // counting it in the numerator while excluding it from the denominator is what
    // pushed real books past 100% (the Blue Qur'an at 1000%, Hugh of Santalla at
    // 105.6%). Both must exclude it.
    const pages = [
      { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
      { page_number: 2, ocr: { data: 'b' }, page_type: 'blank', translation: { data: '[Blank page]' } },
      { page_number: 3, ocr: { data: 'c' }, page_type: 'bookplate', translation: { data: 'C' } },
      { page_number: 4, ocr: { data: 'd' } }, // translatable, not yet translated
      { page_number: 5 }, // no OCR — nothing to translate from
      { page_number: 6, ocr: { data: 'f' }, ocrRecitation: true },
    ];
    // page 6 is refused by the model — expressed the way the writers store it
    (pages[5] as Record<string, unknown>).ocr = { data: 'f', recitation_blocked: true };

    const stats = countVisiblePageStats(pages);
    // Pages 1, 4 and 5. Page 5 has NO OCR and still counts: not-yet-OCR'd is pending
    // work, not impossible work. Excluding it badged half-OCR'd books as 100%.
    expect(stats.translatable).toBe(3);
    expect(stats.translated_translatable).toBe(1); // page 1
    // The ratio can never exceed 1 — the property the old numerator violated.
    expect(stats.translated_translatable).toBeLessThanOrEqual(stats.translatable);
    // And the blank leaf's placeholder is still excluded from pages_translated.
    expect(stats.with_translation).toBe(2); // pages 1 and 3 (bookplate is not 'blank')
    // pages_blank counts never-translated types that carry OCR: the blank and the bookplate.
    expect(stats.blank).toBe(2);
  });

  it('.ts and .mjs NEVER_TRANSLATED_PAGE_TYPES stay in lock-step (#4685)', () => {
    expect([...NEVER_TRANSLATED_MJS].sort()).toEqual([...NEVER_TRANSLATED_TS].sort());
  });

  it('regression: hidden translated pages do not fabricate a low translated count', () => {
    // Mirrors histoire-de-la-magie: many visible translated pages, plus hidden
    // pages. The all-pages counter would have produced the wrong totals; the
    // visible-only counter must report the visible truth.
    const pages = [];
    for (let n = 1; n <= 581; n++) {
      pages.push({ page_number: n, ocr: { data: 'o' }, translation: { data: 't' } });
    }
    for (let n = 582; n <= 620; n++) {
      pages.push({ page_number: n, ocr: { data: 'o' } }); // visible, untranslated
    }
    // soft-hidden trailing pages (front/back matter removed from the reader)
    for (let i = 1; i <= 309; i++) {
      pages.push({ page_number: -i, ocr: { data: 'o' }, translation: { data: 't' } });
    }
    const stats = countVisiblePageStats(pages);
    expect(stats.total).toBe(620); // "N scans" — visible only, not 929
    expect(stats.with_ocr).toBe(620);
    expect(stats.with_translation).toBe(581); // not 20, not 890
    // >90%-readable and >5% gates both see the visible truth
    expect(stats.with_translation / stats.total).toBeGreaterThan(0.9);
  });
});

/**
 * Blank leaves are not translations.
 *
 * The translator writes the literal placeholder "[Blank page — no translatable
 * content]" onto every blank page, so a plain non-empty check counted 87,777
 * flyleaves and endpapers as translated work (99.8% under 120 characters).
 *
 * Worse, it broke the ratio: `translation_pct` divides by
 * `pages_ocr - pages_blank`, so blank pages left the denominator while staying
 * in the numerator. 6,228 live books — 32% of the public library — reported
 * over 100% translated. The Blue Qur'an reported 1000%: 60 pages, 54 blank,
 * denominator 6.
 */
describe('blank pages are excluded from pages_translated', () => {
  const blankPage = {
    page_number: 4,
    page_type: 'blank',
    ocr: { data: '<page-type>blank</page-type>' },
    translation: { data: '[Blank page — no translatable content]' },
  };

  it('isBlankPage identifies the blank page_type', () => {
    expect(isBlankPage(blankPage)).toBe(true);
    expect(isBlankPage({ page_type: 'text' })).toBe(false);
    expect(isBlankPage({})).toBe(false);
    expect(isBlankPage(null)).toBe(false);
  });

  it('isTranslatedPage rejects a blank page that carries placeholder text', () => {
    // hasTranslation stays literal — the text IS non-empty…
    expect(hasTranslation(blankPage)).toBe(true);
    // …but it does not count as translated work.
    expect(isTranslatedPage(blankPage)).toBe(false);
    expect(isTranslatedPage({ page_type: 'text', translation: { data: 'real' } })).toBe(true);
    expect(isTranslatedPage({ translation: { data: 'real' } })).toBe(true);
  });

  it('the pipeline excludes blank pages from with_translation', () => {
    const group = buildVisiblePageCountPipeline('b1')[1].$group;
    expect(JSON.stringify(group.with_translation)).toContain('blank');
  });

  it('reproduces the Blue Qur\'an: 60 pages, 54 blank, and no longer 1000%', () => {
    const pages = [];
    for (let n = 1; n <= 6; n++) {
      pages.push({ page_number: n, page_type: 'text', ocr: { data: 'o' }, translation: { data: 'real translation' } });
    }
    for (let n = 7; n <= 60; n++) {
      pages.push({
        page_number: n, page_type: 'blank',
        ocr: { data: '<page-type>blank</page-type>' },
        translation: { data: '[Blank page — no translatable content]' },
      });
    }
    const stats = countVisiblePageStats(pages);
    expect(stats.total).toBe(60);
    expect(stats.with_ocr).toBe(60);
    expect(stats.with_translation).toBe(6); // was 60 — the numerator bug

    // translation_pct divides by (pages_ocr - pages_blank) = 60 - 54 = 6.
    const denominator = stats.with_ocr - 54;
    expect((stats.with_translation / denominator) * 100).toBe(100); // was 1000
  });

  it('a half-OCR\'d book does not read as complete (Theatrum Chemicum regression)', () => {
    // Real shape: 4,198 visible pages, only 2,003 with OCR, 1,985 translated. The first
    // version of the denominator excluded un-OCR'd pages, so this book displayed
    // **100% translated** with 2,195 pages carrying no text at all. 1,701 books were
    // in that state. The denominator must count pages that WILL be translatable.
    const pages = [];
    for (let n = 1; n <= 1985; n++) pages.push({ page_number: n, ocr: { data: 'o' }, translation: { data: 't' } });
    for (let n = 1986; n <= 2003; n++) pages.push({ page_number: n, ocr: { data: 'o' }, page_type: 'blank', translation: { data: '[Blank page]' } });
    for (let n = 2004; n <= 4198; n++) pages.push({ page_number: n }); // awaiting OCR

    const stats = countVisiblePageStats(pages);
    expect(stats.total).toBe(4198);
    expect(stats.translatable).toBe(4180); // everything except the 18 blank leaves
    expect(stats.translated_translatable).toBe(1985);
    const pct = Math.round((100 * stats.translated_translatable) / stats.translatable);
    expect(pct).toBe(47); // honest, and nowhere near 100
  });
});

/**
 * Illustration text-free guard (#4685, also closes #4507).
 *
 * digitizer-insert is excluded outright (added to NEVER_TRANSLATED_PAGE_TYPES above,
 * like blank/exlibris/bookplate/digitizer-notice): 10/10 sampled digitizer-insert
 * pages were scanning-service boilerplate.
 *
 * illustration is guarded, not blanket-excluded: 37/40 sampled illustration +
 * digitizer-insert pages had nothing to translate, but 1 was a mistagged manuscript
 * spread carrying a full Latin prayer under an `illustration` tag, and diagram/map
 * pages (kept IN unconditionally, never guarded) were substantive 3/3. The guard
 * strips <image-desc>/<meta>/<warning>/<insert>/<vocab> blocks WITH their content,
 * then all remaining tag markup (the always-present <language>/<page-type>/<script>
 * wrapper, which would otherwise put a ~40-char floor under every page regardless of
 * content), and excludes only if under 40 chars remain.
 */
describe('illustration text-free guard (#4685)', () => {
  it('digitizer-insert is excluded outright, unconditionally', () => {
    expect(NEVER_TRANSLATED_MJS).toContain('digitizer-insert');
    const page = { page_number: 1, page_type: 'digitizer-insert', ocr: { data: 'Digitized by Google as part of an ongoing effort.' } };
    expect(isTranslatablePageForCount(page)).toBe(false);
  });

  it('illustration with description-only OCR (a fore-edge/binding photo) is excluded', () => {
    // Real sample (#4685 C-cohort record #1): fore-edge photo, ProQuest credit line,
    // and a shelfmark — nothing a translator can act on.
    const ocr = '<language>English</language>\n<page-type>illustration</page-type>\n\n' +
      '<image-desc>A photograph showing the fore-edge and spine of a bound book.</image-desc>\n\n' +
      '<vocab>vellum binding, stained edges</vocab>';
    const page = { page_number: 4, page_type: 'illustration', ocr: { data: ocr } };
    expect(isTextFreeIllustration(page)).toBe(true);
    expect(isTranslatablePageForCount(page)).toBe(false);
  });

  it('illustration carrying 1,000+ chars of real Latin text (a mistagged manuscript spread) stays IN', () => {
    // Real sample (#4685 C-cohort record #3): a Book of Hours spread mistagged
    // `illustration`, actually a full Latin prayer. The guard must not exclude it.
    const latinPrayer = 'De sancto Iacobo apostolo. '.repeat(40); // > 1,000 chars
    const ocr = `<language>la</language>\n<page-type>illustration</page-type>\n<script>handwritten</script>\n\n${latinPrayer}`;
    const page = { page_number: 257, page_type: 'illustration', ocr: { data: ocr } };
    expect(isTextFreeIllustration(page)).toBe(false);
    expect(isTranslatablePageForCount(page)).toBe(true);
  });

  it('diagram with labelled content stays IN — never guarded, whatever its length', () => {
    // Real sample (#4685 C-cohort records #26, #33): Chinese cosmological diagrams
    // with labels, substantive 2/2. diagram is not in NEVER_TRANSLATED_PAGE_TYPES and
    // isTextFreeIllustration only ever fires on page_type === 'illustration'.
    const shortDiagram = { page_number: 6, page_type: 'diagram', ocr: { data: '<language>Chinese</language>\n<page-type>diagram</page-type>' } };
    expect(isTextFreeIllustration(shortDiagram)).toBe(false);
    expect(isTranslatablePageForCount(shortDiagram)).toBe(true);
  });

  it('map stays IN — never guarded', () => {
    const map = { page_number: 4, page_type: 'map', ocr: { data: '<language>None</language>\n<page-type>map</page-type>' } };
    expect(isTextFreeIllustration(map)).toBe(false);
    expect(isTranslatablePageForCount(map)).toBe(true);
  });

  it('an illustration page with no OCR yet is pending work, not proven-empty — stays IN', () => {
    const page = { page_number: 4, page_type: 'illustration' };
    expect(isTextFreeIllustration(page)).toBe(false);
    expect(isTranslatablePageForCount(page)).toBe(true);
  });

  it('stripIllustrationBoilerplate removes descriptive-block CONTENT but keeps other tags\' inner text', () => {
    // <image-desc> is stripped WITH its content (it's pure description, never page
    // content); <language>/<page-type> markup is stripped but their trivial inner
    // text survives — a tag we didn't anticipate (<header>) keeps its text too, so
    // real content is never silently discarded.
    const ocr = '<language>Latin</language><page-type>illustration</page-type>' +
      '<image-desc>A woodcut.</image-desc><header>Chapter One</header>';
    expect(stripIllustrationBoilerplate(ocr)).toBe('LatinillustrationChapter One');
  });

  it('countVisiblePageStats excludes a text-free illustration from translatable', () => {
    const pages = [
      { page_number: 1, page_type: 'illustration', ocr: { data: '<language>None</language><page-type>illustration</page-type>' } },
      { page_number: 2, page_type: 'text', ocr: { data: 'real body text' }, translation: { data: 'x' } },
    ];
    const stats = countVisiblePageStats(pages);
    expect(stats.translatable).toBe(1); // only page 2
    expect(stats.translated_translatable).toBe(1);
  });

  it('buildVisiblePageCountPipeline expresses the guard as a read of ocr.text_free, not a re-derivation', () => {
    // Mongo cannot exactly regex-strip the descriptive tags, so the pipeline reads a
    // stamped field instead — see the TRANSLATABLE_COND comment. Confirm the group
    // stage references it.
    const group = buildVisiblePageCountPipeline('b1')[1].$group;
    expect(JSON.stringify(group.translatable)).toContain('text_free');
    expect(JSON.stringify(group.translatable)).toContain('illustration');
  });
});
