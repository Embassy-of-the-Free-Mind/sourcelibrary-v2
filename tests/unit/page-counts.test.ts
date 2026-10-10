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
  isBlockedForModel,
  computeTranslationMetrics,
  FULL_TRANSLATION_MIN_OCR_COVERAGE,
  computeTranslationState as computeTranslationStateMjs,
  isEnglishOriginal as isEnglishOriginalMjs,
  TRANSLATION_RUNGS as TRANSLATION_RUNGS_MJS,
  TRANSLATION_STATE_VERSION as TRANSLATION_STATE_VERSION_MJS,
  READABLE_MIN_TRANSLATED as READABLE_MIN_TRANSLATED_MJS,
  READABLE_IN_ENGLISH_FILTER as READABLE_IN_ENGLISH_FILTER_MJS,
  READABLE_IN_ENGLISH_EXPR as READABLE_IN_ENGLISH_EXPR_MJS,
  isReadableInEnglish as isReadableInEnglishMjs,
  catalogTranslationColumns,
} from '../../scripts/lib/page-counts.mjs';
import {
  NEVER_TRANSLATED_PAGE_TYPES as NEVER_TRANSLATED_TS,
  computeTranslationState as computeTranslationStateTs,
  TRANSLATION_RUNGS as TRANSLATION_RUNGS_TS,
  TRANSLATION_STATE_VERSION as TRANSLATION_STATE_VERSION_TS,
  FULL_TRANSLATION_MIN_OCR_COVERAGE as FULL_TRANSLATION_MIN_OCR_COVERAGE_TS,
  READABLE_MIN_TRANSLATED as READABLE_MIN_TRANSLATED_TS,
  READABLE_IN_ENGLISH_FILTER as READABLE_IN_ENGLISH_FILTER_TS,
  READABLE_IN_ENGLISH_EXPR as READABLE_IN_ENGLISH_EXPR_TS,
  isReadableInEnglish as isReadableInEnglishTs,
} from '../../src/lib/page-counts';
import { READABLE_IN_ENGLISH_OR } from '../../src/lib/books-catalog';

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
      archived: 0,
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
    // pages_blank is `page_type: 'blank'` with OCR — the blank leaf only, not the
    // bookplate (design decision 3, #5325). It must name the same set that
    // with_translation excludes, or numerator and denominator drift apart (#3747).
    expect(stats.blank).toBe(1);
  });

  it('.ts and .mjs NEVER_TRANSLATED_PAGE_TYPES stay in lock-step (#4685)', () => {
    expect([...NEVER_TRANSLATED_MJS].sort()).toEqual([...NEVER_TRANSLATED_TS].sort());
  });

  it('a page we have permanently given up on leaves the translatable denominator (#4674)', () => {
    // The give-up flag is the general sibling of recitation_blocked: three failed
    // reads of any kind and the page is out of the queue. It has to leave this
    // denominator too, or every such book reports a gap it will never close — the
    // Tabiena Summa showed 1002/1003 forever on one runaway-generation folio.
    const pages = [
      { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
      { page_number: 2, ocr: { data: 'b' }, translation: { data: 'B' } },
      { page_number: 3, ocr: { fail_blocked: true, fail_count: 3, fail_reason: 'over-hallucination-limit' } },
    ];

    const stats = countVisiblePageStats(pages);
    // Only pages 1 and 2. Page 3 is impossible work, not pending work.
    expect(stats.translatable).toBe(2);
    expect(stats.translated_translatable).toBe(2);
    // …so the book reads as fully translated rather than stuck at 2/3 forever.
    expect(stats.translated_translatable).toBe(stats.translatable);
  });

  it('a page still under its 3-strike budget stays in the denominator (#4674)', () => {
    // The counterpart control: fail_count alone must NOT remove a page, or one
    // transient failure would silently shrink the denominator and overstate
    // completeness — the exact failure this file exists to pin against.
    const pages = [
      { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
      { page_number: 2, ocr: { fail_count: 2, fail_reason: 'no-text:SAFETY' } },
    ];

    const stats = countVisiblePageStats(pages);
    expect(stats.translatable).toBe(2);
    expect(stats.translated_translatable).toBe(1);
  });

  it('a give-up does not outlive the model that made it (#4674)', () => {
    // 959 of 967 blocked pages had not been retried in over a month, and half of a
    // re-probed sample read cleanly against the CURRENT model. A block that names no
    // model is permanent; one that names its model must expire when the model changes.
    const blocked = { ocr: { fail_blocked: true, fail_blocked_model: 'gemini-3.1-flash-lite' } };
    expect(isBlockedForModel(blocked, 'gemini-3.1-flash-lite')).toBe(true);   // same model — still blocked
    expect(isBlockedForModel(blocked, 'gemini-3-flash-preview')).toBe(false); // new model — reopened

    // A legacy block records no model. It stays blocked under every model: reopening
    // 967 pages is a spend decision, not something a deploy should do by itself.
    const legacy = { ocr: { fail_blocked: true } };
    expect(isBlockedForModel(legacy, 'gemini-3.1-flash-lite')).toBe(true);
    expect(isBlockedForModel(legacy, 'anything-else')).toBe(true);

    // And a page nobody gave up on is never blocked.
    expect(isBlockedForModel({ ocr: { fail_count: 2 } }, 'gemini-3.1-flash-lite')).toBe(false);
    expect(isBlockedForModel({}, 'gemini-3.1-flash-lite')).toBe(false);
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

describe('is_fully_translated requires OCR coverage, not just completion (#5063)', () => {
  // The shape that produced 1,369 visible false badges: the 25-page preview is the
  // only OCR, and every preview page is translated. Completion is 100% of what was
  // read; coverage is 4% of the book.
  it('a preview-only book (25 translated / 25 ocr / 694 pages) is NOT fully translated', () => {
    const m = computeTranslationMetrics({ pages_count: 694, pages_ocr: 25, pages_translated: 25, pages_blank: 0 });
    expect(m.is_fully_translated).toBe(false);
    expect(m.over_90_translated).toBe(false);
    // and the stored percentage says what a reader would find, not 100
    expect(m.translation_pct).toBeCloseTo(3.6, 1);
  });

  it('a finished book with an untranslated tail inside coverage (300 / 310 / 320, 10 blank) IS fully translated', () => {
    // readable = 310 - 10 = 300 = translated → complete; ocr 310 >= 0.9 * 310 → covered.
    const m = computeTranslationMetrics({ pages_count: 320, pages_ocr: 310, pages_translated: 300, pages_blank: 10 });
    expect(m.is_fully_translated).toBe(true);
    expect(m.over_90_translated).toBe(true);
    expect(m.translation_pct).toBeCloseTo(96.77, 1);
  });

  it('the coverage bar is exactly 90% of the non-blank book', () => {
    expect(FULL_TRANSLATION_MIN_OCR_COVERAGE).toBe(0.9);
    // 100 non-blank pages: 89 OCR'd and translated fails, 90 passes.
    expect(computeTranslationMetrics({ pages_count: 100, pages_ocr: 89, pages_translated: 89, pages_blank: 0 }).is_fully_translated).toBe(false);
    expect(computeTranslationMetrics({ pages_count: 100, pages_ocr: 90, pages_translated: 90, pages_blank: 0 }).is_fully_translated).toBe(true);
  });

  it('completion is still measured against READABLE pages (pages_ocr - pages_blank)', () => {
    // Fully covered, but 20 of 100 readable pages not yet translated: neither flag.
    expect(computeTranslationMetrics({ pages_count: 100, pages_ocr: 100, pages_translated: 80, pages_blank: 0 }))
      .toMatchObject({ is_fully_translated: false, over_90_translated: false });
    expect(computeTranslationMetrics({ pages_count: 100, pages_ocr: 100, pages_translated: 92, pages_blank: 0 }))
      .toMatchObject({ is_fully_translated: false, over_90_translated: true });
  });

  it('translation_pct prefers pages_translatable (the #4442 denominator) and never exceeds 100', () => {
    // Recounted book: 50 translatable of 80 pages, all 50 done → 100, not 62.5.
    expect(computeTranslationMetrics({ pages_count: 80, pages_ocr: 80, pages_translated: 50, pages_blank: 0, pages_translatable: 50 }).translation_pct).toBe(100);
    // A stale numerator above the denominator is clamped, not reported as 1000%.
    expect(computeTranslationMetrics({ pages_count: 60, pages_ocr: 60, pages_translated: 60, pages_blank: 54, pages_translatable: 6 }).translation_pct).toBe(100);
  });

  it('a book with nothing translated is never flagged and reads 0%', () => {
    expect(computeTranslationMetrics({ pages_count: 0, pages_ocr: 0, pages_translated: 0, pages_blank: 0 }))
      .toEqual({ translation_pct: 0, is_fully_translated: false, over_90_translated: false });
    expect(computeTranslationMetrics({}))
      .toEqual({ translation_pct: 0, is_fully_translated: false, over_90_translated: false });
  });
});

describe('computeTranslationState: one ladder, one denominator (#5284)', () => {
  const rungIndex = (r: string) => TRANSLATION_RUNGS_MJS.indexOf(r);

  it('the #5063 preview-only book lands on transcribing even at 25/25 translated', () => {
    const s = computeTranslationStateMjs({ pages_count: 694, pages_ocr: 25, pages_translated: 25, pages_blank: 0, pages_translatable: 25 });
    expect(s.rung).toBe('transcribing');
  });

  it('Theatrum Chemicum vol. 6 (#4516: 4,198 pages, 2,003 OCR\'d, all of it translated) is transcribing', () => {
    const s = computeTranslationStateMjs({ pages_count: 4198, pages_ocr: 2003, pages_translated: 2003, pages_blank: 0, pages_translatable: 2003 });
    expect(s.rung).toBe('transcribing');
  });

  it('a book of plates (translatable 0, coverage met, nothing translated) is transcribed, not complete', () => {
    const s = computeTranslationStateMjs({ pages_count: 40, pages_ocr: 40, pages_translated: 0, pages_blank: 2, pages_translatable: 0 });
    expect(s.rung).toBe('transcribed');
    expect(s).toMatchObject({ translatable: 0, whole: 38, exact: true });
  });

  it('walks every rung at the 90% and 100% bars', () => {
    const base = { pages_count: 100, pages_blank: 0, pages_translatable: 100 };
    expect(computeTranslationStateMjs({ pages_count: 0 }).rung).toBe('no_pages');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 100, pages_translated: 100 }, { content_type: 'artwork' }).rung).toBe('no_pages');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 0, pages_translated: 0 }).rung).toBe('no_text');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 89, pages_translated: 0 }).rung).toBe('transcribing');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 90, pages_translated: 0 }).rung).toBe('transcribed');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 100, pages_translated: 89 }).rung).toBe('translating');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 100, pages_translated: 90 }).rung).toBe('readable');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 100, pages_translated: 99 }).rung).toBe('readable');
    expect(computeTranslationStateMjs({ ...base, pages_ocr: 100, pages_translated: 100 }).rung).toBe('complete');
  });

  it('uses pages_translatable when stamped, whole (pages_count − pages_blank) when not', () => {
    const exact = computeTranslationStateMjs({ pages_count: 120, pages_ocr: 120, pages_translated: 100, pages_blank: 10, pages_translatable: 100 });
    expect(exact).toMatchObject({ rung: 'complete', translatable: 100, whole: 110, exact: true });
    const fallback = computeTranslationStateMjs({ pages_count: 120, pages_ocr: 120, pages_translated: 100, pages_blank: 10 });
    expect(fallback).toMatchObject({ rung: 'readable', translatable: 110, whole: 110, exact: false });
    // null is "not recounted", not zero
    expect(computeTranslationStateMjs({ pages_count: 120, pages_ocr: 120, pages_translated: 100, pages_blank: 10, pages_translatable: null }).exact).toBe(false);
  });

  it('a fallback book never reads higher than the same book once recounted', () => {
    // pages_translatable <= pages_count - pages_blank by construction, so sweep that region.
    for (const pages_count of [1, 10, 37, 100]) {
      for (const pages_blank of [0, Math.floor(pages_count / 5)]) {
        const whole = pages_count - pages_blank;
        for (let pages_ocr = 0; pages_ocr <= pages_count; pages_ocr += Math.max(1, Math.floor(pages_count / 10))) {
          for (let pages_translatable = 0; pages_translatable <= whole; pages_translatable++) {
            for (let pages_translated = 0; pages_translated <= pages_ocr; pages_translated += Math.max(1, Math.floor(pages_ocr / 7))) {
              const c = { pages_count, pages_ocr, pages_translated, pages_blank };
              const withExact = computeTranslationStateMjs({ ...c, pages_translatable });
              const withFallback = computeTranslationStateMjs(c);
              expect(rungIndex(withFallback.rung), JSON.stringify({ ...c, pages_translatable })).toBeLessThanOrEqual(rungIndex(withExact.rung));
            }
          }
        }
      }
    }
  });

  it('english_original reads the FIRST language of the edition', () => {
    for (const lang of ['English', 'english', 'en', 'ENG', 'English and Hebrew', 'English; Latin', 'English (Middle)']) {
      expect(isEnglishOriginalMjs(lang), lang).toBe(true);
    }
    for (const lang of ['Latin', 'Latin; English', 'Latin and English', 'German', 'Englisch', '', null, undefined]) {
      expect(isEnglishOriginalMjs(lang), String(lang)).toBe(false);
    }
    expect(computeTranslationStateMjs({ pages_count: 10, pages_ocr: 10 }, { language: 'English' }).english_original).toBe(true);
  });

  it('carries its inputs and the rule version so a wrong rung is traceable', () => {
    expect(computeTranslationStateMjs({ pages_count: 50, pages_ocr: 48, pages_translated: 30, pages_blank: 2, pages_translatable: 44 }, { language: 'Latin' }))
      .toEqual({ rung: 'translating', english_original: false, translated: 30, translatable: 44, whole: 48, ocr: 48, exact: true, version: TRANSLATION_STATE_VERSION_MJS });
  });

  // Parity: every copy of the rule, imported (translate-core-parity lesson in
  // .claude/docs/invariants/tests-that-are-not-guards.md). A copy nobody imports
  // is a copy nobody tests.
  it('the .mjs and .ts copies agree on every fixture', () => {
    const fixtures: Array<[Record<string, number | null | undefined>, { language?: unknown; content_type?: unknown }]> = [];
    const langs = ['English', 'Latin; English', 'English and Hebrew', 'eng', null];
    const types = [null, 'artwork', 'book'];
    let i = 0;
    for (const pages_count of [0, 1, 25, 100, 694, 4198]) {
      for (const ocrShare of [0, 0.036, 0.5, 0.89, 0.9, 1]) {
        for (const trShare of [0, 0.5, 0.89, 0.9, 0.95, 1]) {
          for (const pages_translatable of [undefined, null, 0, Math.floor(pages_count * 0.8), pages_count]) {
            const pages_ocr = Math.round(pages_count * ocrShare);
            fixtures.push([
              { pages_count, pages_ocr, pages_translated: Math.round(pages_ocr * trShare), pages_blank: i % 3 === 0 ? Math.floor(pages_count / 10) : 0, pages_translatable },
              { language: langs[i % langs.length], content_type: types[i % types.length] },
            ]);
            i++;
          }
        }
      }
    }
    fixtures.push([{}, {}], [{ pages_count: -5, pages_ocr: -1 }, {}]);
    const rungsSeen = new Set<string>();
    for (const [counts, meta] of fixtures) {
      const a = computeTranslationStateMjs(counts, meta);
      const b = computeTranslationStateTs(counts, meta);
      expect(b, JSON.stringify([counts, meta])).toEqual(a);
      rungsSeen.add(a.rung);
    }
    // The table must exercise the whole ladder, or parity over it proves little.
    expect([...rungsSeen].sort()).toEqual([...TRANSLATION_RUNGS_MJS].sort());
    expect([...TRANSLATION_RUNGS_TS]).toEqual(TRANSLATION_RUNGS_MJS);
    expect(TRANSLATION_STATE_VERSION_TS).toBe(TRANSLATION_STATE_VERSION_MJS);
    expect(FULL_TRANSLATION_MIN_OCR_COVERAGE_TS).toBe(FULL_TRANSLATION_MIN_OCR_COVERAGE);
    expect(READABLE_MIN_TRANSLATED_TS).toBe(READABLE_MIN_TRANSLATED_MJS);
  });
});

describe('readable_in_english: the named headline view (#5286)', () => {
  // translation-state.md § Named views: rung ∈ {readable, complete}
  // ∪ (english_original ∧ rung ∈ {transcribed, translating}).
  const expected: Record<string, [boolean, boolean]> = {
    //            [non-English, English original]
    no_pages: [false, false],
    no_text: [false, false],
    transcribing: [false, false], // a preview is never readable, English or not (#5063)
    transcribed: [false, true],
    translating: [false, true],
    readable: [true, true],
    complete: [true, true],
  };

  it('matches the design table on every rung, in both twins', () => {
    expect(Object.keys(expected).sort()).toEqual([...TRANSLATION_RUNGS_MJS].sort());
    for (const rung of TRANSLATION_RUNGS_MJS) {
      for (const [i, english_original] of [false, true].entries()) {
        const state = { rung, english_original };
        expect(isReadableInEnglishMjs(state), JSON.stringify(state)).toBe(expected[rung][i]);
        expect(isReadableInEnglishTs(state as never), JSON.stringify(state)).toBe(expected[rung][i]);
      }
    }
  });

  it('an unstamped book is in no view', () => {
    expect(isReadableInEnglishMjs(undefined)).toBe(false);
    expect(isReadableInEnglishMjs({})).toBe(false);
    expect(isReadableInEnglishTs(null)).toBe(false);
  });

  it('the Mongo filter and aggregation forms are identical across twins', () => {
    expect(READABLE_IN_ENGLISH_FILTER_TS).toEqual(READABLE_IN_ENGLISH_FILTER_MJS);
    expect(READABLE_IN_ENGLISH_EXPR_TS).toEqual(READABLE_IN_ENGLISH_EXPR_MJS);
  });
});

describe('readable_in_english view (#5288)', () => {
  const cases: Array<[string, boolean, boolean]> = [
    // [rung, english_original, readable_in_english]
    ['no_pages', false, false], ['no_pages', true, false],
    ['no_text', false, false], ['no_text', true, false],
    ['transcribing', false, false], ['transcribing', true, false],
    ['transcribed', false, false], ['transcribed', true, true],
    ['translating', false, false], ['translating', true, true],
    ['readable', false, true], ['readable', true, true],
    ['complete', false, true], ['complete', true, true],
  ];

  it('is the design table, in both copies', () => {
    for (const [rung, english_original, want] of cases) {
      expect(isReadableInEnglishMjs({ rung, english_original }), `${rung}/${english_original}`).toBe(want);
      expect(isReadableInEnglishTs({ rung, english_original }), `${rung}/${english_original}`).toBe(want);
    }
    expect(isReadableInEnglishMjs(null)).toBe(false);
    expect(isReadableInEnglishTs(undefined)).toBe(false);
  });

  it('the PostgREST expression names the same rungs as the predicate', () => {
    expect(READABLE_IN_ENGLISH_OR).toBe(
      'translation_rung.in.(readable,complete),and(english_original.is.true,translation_rung.in.(transcribed,translating))',
    );
  });

  it('a 25-page preview of a 694-page book is not readable; an English original transcribed is', () => {
    const preview = catalogTranslationColumns({ pages_count: 694, pages_ocr: 25, pages_translated: 25, pages_blank: 0, language: 'Latin' });
    expect(preview).toEqual({ translation_rung: 'transcribing', english_original: false });
    const english = catalogTranslationColumns({ pages_count: 200, pages_ocr: 200, pages_translated: 0, pages_blank: 0, language: 'English' });
    expect(isReadableInEnglishMjs({ rung: english.translation_rung, english_original: english.english_original })).toBe(true);
  });

  it('catalogTranslationColumns prefers a current stamp, recomputes a stale or missing one', () => {
    const counts = { pages_count: 100, pages_ocr: 100, pages_translated: 100, pages_blank: 0, language: 'Latin' };
    const current = { ...counts, translation_state: { rung: 'readable', english_original: false, version: TRANSLATION_STATE_VERSION_MJS } };
    expect(catalogTranslationColumns(current).translation_rung).toBe('readable');
    const stale = { ...counts, translation_state: { rung: 'readable', english_original: false, version: TRANSLATION_STATE_VERSION_MJS - 1 } };
    expect(catalogTranslationColumns(stale).translation_rung).toBe('complete');
    expect(catalogTranslationColumns(counts).translation_rung).toBe('complete');
  });
});
