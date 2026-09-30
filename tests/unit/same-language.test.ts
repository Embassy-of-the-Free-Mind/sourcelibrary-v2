/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * Same-language mode (page-error taxonomy T12, #5154): a page already written in English is copied
 * through, not sent to the model to be paraphrased.
 *
 * Fixtures are real mirror pages. Positives: a 19th-century English preface in a Maori edition and
 * a 17th-century English page with long ſ. Negative controls — the shapes the 1-in-20 mirror walk
 * found the naive test firing on, each pinned so a loosening is noticed: prose in Latin, Dutch and
 * German; a model's DESCRIPTION of a blank leaf (English, but not the page); a Latin page with the
 * OCR model's English reasoning appended; and a page whose tag names a second language.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  englishSource, sameLanguageText, sameLanguageTranslation, SAME_LANGUAGE_SOURCE, SAME_LANGUAGE_ENGINE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/same-language.mjs';
import {
  contentHash,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/write-provenance.mjs';

const C = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/same-language/pages.json'), 'utf8')).cases as Record<string, any>;

describe('T12 · is this page already English? (#5154)', () => {
  it('copies an English preface in a non-English book (Maori MSS., p.9)', () => {
    expect(englishSource(C.maori_preface.ocr)).toMatchObject({ judged: true, english: true });
  });
  it('copies 17th-century English with long ſ', () => {
    expect(englishSource(C.english_1600s.ocr)).toMatchObject({ judged: true, english: true });
  });
  it('NEGATIVE CONTROL: Latin, Dutch and German prose are translated, not copied', () => {
    for (const k of ['latin_prose', 'dutch_prose', 'german_prose']) expect(englishSource(C[k].ocr).english, k).toBe(false);
  });
  it('NEGATIVE CONTROL: a model description of a blank leaf is not the page', () => {
    expect(englishSource(C.latin_blank_desc.ocr)).toMatchObject({ judged: false, why: 'described-page' });
  });
  it('NEGATIVE CONTROL: a Latin page with the OCR model\'s English reasoning appended is not English', () => {
    expect(englishSource(C.latin_leak.ocr).english).toBeFalsy();
  });
  it('NEGATIVE CONTROL: a tag naming a second language (or another language) keeps the page on the translator', () => {
    const body = C.maori_preface.ocr.replace(/<(?:language|lang)>[^<]*<\/(?:language|lang)>/i, '');
    expect(englishSource('<language>English, Latin</language>\n' + body)).toMatchObject({ english: false, why: 'multilingual-tag' });
    expect(englishSource('<language>Latin</language>\n' + body)).toMatchObject({ english: false, why: 'tag-not-english' });
  });
  it('is unjudged on a short page', () => {
    expect(englishSource('<language>English</language>\nThe end of the book.')).toMatchObject({ judged: false, why: 'short' });
  });
});

describe('the copy', () => {
  it('is the transcription verbatim, minus the scan-description tags', () => {
    const ocr = '<language>English</language>\n<script>printed</script>\n<columns>1</columns>\n<page-num>14</page-num>\nThe text, with <margin>a note</margin>, as printed.';
    expect(sameLanguageText(ocr)).toBe('<language>English</language>\n<page-num>14</page-num>\nThe text, with <margin>a note</margin>, as printed.');
  });
  it('carries provenance: source, engine, the input hash, and a content hash of what is stored', async () => {
    const page = { id: 'p1', ocr: { data: C.maori_preface.ocr, updated_at: new Date('2026-01-01') } };
    const t = await sameLanguageTranslation(page, { jobId: 'j1' });
    expect(t).toMatchObject({ source: SAME_LANGUAGE_SOURCE, language: 'English', model: null });
    expect(t.data).toBe(sameLanguageText(C.maori_preface.ocr));
    expect(t.content_hash).toBe(contentHash(t.data));
    expect(t.engine.name).toBe(SAME_LANGUAGE_ENGINE);
    expect(t.engine.input.source_text_hash).toBe(contentHash(C.maori_preface.ocr));
    expect(t.engine.run).toMatchObject({ job_id: 'j1' });
  });
});
