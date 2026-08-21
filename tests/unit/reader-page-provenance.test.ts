/**
 * Reader-path provenance — markPageForReader and the write-boundary strip.
 *
 * The reader (server-rendered page HTML + the /api/pages routes) is the main
 * extraction surface now that the bulk fleets are blocked (#3850). These tests
 * pin the properties the design depends on:
 *
 *  - translation.data carries an AUTHENTIC invisible mark; OCR is untouched
 *  - marking is deterministic (the routes are shared/ISR-cached — every viewer
 *    must receive identical bytes)
 *  - stripping the mark restores the original byte-for-byte (the editor
 *    round-trip: served text goes back through PATCH, which strips before
 *    storing — marks must never reach the corpus)
 *  - marks never break <note>-family tag pairing (they insert only at
 *    sentence-boundary joints, but this is the regression net if placement
 *    ever changes)
 */
import { describe, it, expect, beforeAll } from 'vitest';

const KEY = 'test-provenance-key-for-reader-path';

// provenance.ts captures PROVENANCE_SECRET_KEY at module load — set it before
// the dynamic import so markForExport actually marks.
let provenance: typeof import('@/lib/provenance');

beforeAll(async () => {
  process.env.PROVENANCE_SECRET_KEY = KEY;
  provenance = await import('@/lib/provenance');
});

const ZWC_RE = /[​-‏⁠-⁤﻿]/;

const TRANSLATION =
  'The stone is found in the old earth. It ripens under a gentle fire? ' +
  'Indeed. The work is completed when the red appears. ' +
  'Thus wrote the philosopher in the third chapter.';

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    book_id: '6a358363f13bd628cd511681',
    page_number: 3,
    ocr: { data: 'Der Stein wird in der alten Erde gefunden. Er reift.', language: 'de' },
    translation: { data: TRANSLATION, language: 'en' },
    ...overrides,
  };
}

describe('markPageForReader', () => {
  it('marks translation.data with an authentic imprimatur', () => {
    const marked = provenance.markPageForReader(page());
    expect(marked.translation!.data).not.toBe(TRANSLATION);
    expect(ZWC_RE.test(marked.translation!.data as string)).toBe(true);
    const verdict = provenance.verifyExport(marked.translation!.data as string);
    expect(verdict?.authentic).toBe(true);
    expect(verdict?.editionId).toBe('6a358363');
  });

  it('leaves the OCR byte-identical — bidi marks can be real content there', () => {
    const original = page();
    const marked = provenance.markPageForReader(original);
    expect(marked.ocr).toBe(original.ocr);
    expect(marked.ocr.data).toBe(original.ocr.data);
  });

  it('does not mutate the input document', () => {
    const original = page();
    provenance.markPageForReader(original);
    expect(original.translation!.data).toBe(TRANSLATION);
  });

  it('is deterministic — shared caches must serve identical bytes', () => {
    const a = provenance.markPageForReader(page());
    const b = provenance.markPageForReader(page());
    expect(a.translation!.data).toBe(b.translation!.data);
  });

  it('prefers an explicit bookId over the document field', () => {
    const marked = provenance.markPageForReader(page(), 'ffffffffabcdef0123456789');
    const verdict = provenance.verifyExport(marked.translation!.data as string);
    expect(verdict?.editionId).toBe('ffffffff');
  });

  it('passes through pages with no translation, no book id, or non-string data', () => {
    const noTranslation = page({ translation: undefined });
    expect(provenance.markPageForReader(noTranslation)).toBe(noTranslation);
    const noBook = page({ book_id: undefined });
    expect(provenance.markPageForReader(noBook)).toBe(noBook);
    const numeric = page({ translation: { data: 42 } });
    expect(provenance.markPageForReader(numeric)).toBe(numeric);
  });
});

describe('the editor round-trip (write-boundary strip)', () => {
  it('stripProvenanceMarks restores the original byte-for-byte', () => {
    const marked = provenance.markPageForReader(page());
    expect(provenance.stripProvenanceMarks(marked.translation!.data as string)).toBe(TRANSLATION);
  });

  it('a marked translation containing note-family tags keeps its tags pairable', () => {
    const withNotes =
      'He begins with the salt. <note>A marginal gloss appears here. It cites Geber.</note> ' +
      'Then the mercury is added? Yes. <margin>fol. 12v</margin> The vessel is sealed at last.';
    const marked = provenance.markPageForReader(page({ translation: { data: withNotes, language: 'en' } }));
    const text = marked.translation!.data as string;
    // The tag tokens themselves are never split by zero-width insertions...
    expect(text).toContain('<note>');
    expect(text).toContain('</note>');
    expect(text).toContain('<margin>');
    expect(text).toContain('</margin>');
    // ...so the pairing regexes used by exports and the renderer still match.
    expect(/<note>[\s\S]*?<\/note>/.test(text)).toBe(true);
    expect(provenance.stripProvenanceMarks(text)).toBe(withNotes);
  });
});
