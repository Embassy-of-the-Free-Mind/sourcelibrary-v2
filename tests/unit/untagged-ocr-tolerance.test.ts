/**
 * Untagged OCR is a first-class citizen (#4790, Internet Archive text).
 *
 * Our own OCR wraps every page in `<page-type>`, `<language>`, `<header>` …; the ~151K pages
 * filled from the Archive's `_djvu.xml` carry none of it (`ocr.source: 'ia_djvu'`). Audited
 * 2026-09-13: every tag consumer already tolerates the absence — each parser returns null /
 * undefined and its caller falls back to a content heuristic or to the `page_type` FIELD, which
 * these pages do not have either. Nothing fails closed. This test pins that, so a future tag
 * reader that throws or refuses on untagged text is caught here rather than on 151K pages.
 *
 * Deliberately NOT asserted: any inferred page type for untagged text. No model touched these
 * pages, and a `<page-type>text</page-type>` backfill would be a claim we never checked.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { parsePageTypeFromOcr, scorePageForCover } from '../../scripts/lib/cover-scoring.mjs';
// @ts-expect-error — scripts-side module, no types
import { extractPageType, extractColumns, extractScriptType } from '../../scripts/lib/ocr-result-parse.mjs';
// @ts-expect-error — scripts-side module, no types
import { declaresEnglish, classifySourceLanguage } from '../../scripts/lib/english-source-detect.mjs';
// @ts-expect-error — scripts-side module, no types
import { classifyLanguageContent } from '../../scripts/lib/language-content-classify.mjs';
// @ts-expect-error — scripts-side module, no types
import { pageType, pickTitlePage, attributionWindow } from '../../scripts/lib/title-page-ocr.mjs';
// @ts-expect-error — scripts-side module, no types
import { transcriptionBody } from '../../scripts/lib/blank-page-guard.mjs';
// @ts-expect-error — scripts-side module, no types
import { isBlankPage, isTextFreeIllustration, isTranslatablePageForCount } from '../../scripts/lib/page-counts.mjs';
// @ts-expect-error — scripts-side module, no types
import { isTranslatablePage } from '../../scripts/lib/translate-core.mjs';

const IA = 'THE TESTIMONY OF CHRIST\'S SECOND APPEARING.\n\nCHAPTER I.\n\nOf the creation of man, and the fall of the first Adam. It is written that in the beginning God created the heaven and the earth, and the earth was without form and void; and darkness was upon the face of the deep.';
const page = { id: 'p1', book_id: 'b1', page_number: 12, ocr: { data: IA, source: 'ia_djvu' } };

describe('untagged (Archive) OCR passes every tag consumer', () => {
  it('tag parsers return null/undefined, never throw', () => {
    expect(parsePageTypeFromOcr(IA)).toBeNull();
    expect(extractPageType(IA)).toBeUndefined();
    expect(extractColumns(IA)).toBeUndefined();
    expect(extractScriptType(IA)).toBeUndefined();
    expect(pageType(IA)).toBeNull();
    expect(declaresEnglish(IA)).toBeNull();
  });
  it('cover scoring falls through to content heuristics and yields a finite score', () => {
    const r = scorePageForCover(page);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.reason).toBe('unknown');
  });
  it('language detection uses the words when no <language> is declared', () => {
    expect(classifySourceLanguage([IA, IA, IA])).toMatchObject({ verdict: 'english_source', basis: 'function_word_frequency' });
    expect(classifyLanguageContent(IA).dominant).toBe('english');
  });
  it('title-page attribution falls back to prose and SAYS it is untyped', () => {
    expect(pickTitlePage([page])).toMatchObject({ page_number: 12, via: 'first-prose' });
    expect(attributionWindow([page])[0]).toMatchObject({ page_type: 'untyped', untyped_fallback: true });
  });
  it('the blank-page guard reads the whole text as a transcription claim', () => {
    expect(transcriptionBody(IA).length).toBeGreaterThan(200);
  });
  it('page counting and translation treat it as an ordinary content page', () => {
    expect(isBlankPage(page)).toBe(false);
    expect(isTextFreeIllustration(page)).toBe(false);
    expect(isTranslatablePageForCount(page)).toBe(true);
    expect(isTranslatablePage(page)).toEqual({ ok: true });
  });
  it('an unreadable-flagged page is not translated (the empty-target gate, #4790)', () => {
    expect(isTranslatablePage({ ...page, ocr: { ...page.ocr, unreadable: true } })).toEqual({ ok: false, reason: 'ocr-unreadable' });
  });
});
