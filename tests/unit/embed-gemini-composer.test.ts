import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { workerEmbeddingInput } from '../../scripts/lib/page-embedding-text.mjs';

// #6175: embed-gemini.mjs had its own composer that prepended the page's AI `translation_summary`
// and keywords. The row's `translation` column is the composed text, so the AI description was
// stored as the page's quotable snippet (58 of 148 summary-bearing pages sampled) — the #2232
// misquote class. The worker runs on import, so this pins the source: the composer goes through
// the shared pageEmbeddingInput and the worker does not even read the summary fields.
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts/workers/embed-gemini.mjs'), 'utf8');

describe('embed-gemini composes page text through the shared composer', () => {
  const body = src.slice(src.indexOf('function composeEmbedText('), src.indexOf('// Book metadata cache'));
  it('calls the shared workerEmbeddingInput (pageEmbeddingInput + the 20-char floor)', () => {
    expect(body).toContain('workerEmbeddingInput(page, { book })');
  });
  it('never reads the AI summary or keywords', () => {
    expect(src).not.toMatch(/translation_summary\s*:\s*1|translation_keywords\s*:\s*1|page\.translation_summary|page\.translation_keywords/);
  });
});

// #6221: the re-embed enumerator tested `translation.data` non-empty and listed 9.4K rows the worker
// then declined. What the worker writes is decided here, so this is what a predictor must ask.
describe('workerEmbeddingInput', () => {
  const body = 'Real body text about the proportions of the human body.';
  it('embeds a real translation as a translation', () => {
    expect(workerEmbeddingInput({ translation: { data: body }, ocr: { data: 'Latine scriptum est de corpore.' } }))
      .toEqual({ text: body, hasTranslation: true });
  });
  it('falls back to the OCR, with no translation, when the translation is a stub or only wrappers', () => {
    const ocr = 'Latine scriptum est de corpore.';
    expect(workerEmbeddingInput({ translation: { data: '[Blank page]' }, ocr: { data: ocr } })).toEqual({ text: ocr, hasTranslation: false });
    expect(workerEmbeddingInput({ translation: { data: '<meta>A blank page with a library stamp.</meta>' }, ocr: { data: ocr } }))
      .toEqual({ text: ocr, hasTranslation: false });
  });
  it('is null when neither text clears the floor: the worker writes no row', () => {
    expect(workerEmbeddingInput({ translation: { data: '[Blank]' }, ocr: { data: '<page-num>623</page-num>' } })).toBeNull();
    expect(workerEmbeddingInput({ ocr: { data: '' } })).toBeNull();
    expect(workerEmbeddingInput({})).toBeNull();
  });
});
