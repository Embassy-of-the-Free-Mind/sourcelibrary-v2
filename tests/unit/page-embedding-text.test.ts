import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { cleanPageText, pageEmbeddingInput, buildPageEmbeddingRow, EMBED_MODEL } from '../../scripts/lib/page-embedding-text.mjs';

/**
 * Page embeddings now have TWO writers: the bulk cron
 * (scripts/workers/embed-gemini.mjs) and the pipeline
 * (enrich-worker Phase 6, via scripts/lib/embed-book-pages.mjs). This module is
 * the single composer both import.
 *
 * The precedent for pinning it: the BOOK-level composer was copy-pasted into
 * three places, all three carried the same field-name bugs, and 14,237 Supabase
 * rows silently contained the literal line `People: , , , ,`. A wrong field name
 * yields well-formed text that says nothing, so nothing fails loudly.
 */

describe('cleanPageText', () => {
  it('drops editorial wrappers CONTENT AND ALL, not just the tags', () => {
    // These are Gemini's "what this page is about" notes and they routinely
    // describe ADJACENT pages — a page-89 <meta> naming the mercury wheel that
    // is on page 88. Unwrapping instead of deleting would embed page 88's
    // subject into page 89's vector and mislocate every citation to it.
    const text = '<meta>This page discusses mercury.</meta> The visible body text. <keywords>a, b</keywords>';
    const out = cleanPageText(text);
    expect(out).toBe('The visible body text.');
    expect(out).not.toContain('mercury');
  });

  it('removes summary and vocab blocks too', () => {
    const out = cleanPageText('<summary>AI note</summary>real text<vocab>x, y</vocab>');
    expect(out).toBe('real text');
  });

  it('keeps the inner text of ordinary structural tags', () => {
    // <header>/<page-num> wrap real printed words; only the tag goes.
    const out = cleanPageText('<header>ETHICS.</header> the body <page-num>37</page-num>');
    expect(out).toBe('ETHICS. the body 37');
  });

  it('collapses whitespace and trims', () => {
    expect(cleanPageText('  a\n\n   b  ')).toBe('a b');
  });

  it('caps length for the embedding window', () => {
    expect(cleanPageText('x'.repeat(20000)).length).toBe(8000);
  });

  it('is total on junk input', () => {
    expect(cleanPageText(null)).toBe('');
    expect(cleanPageText(undefined)).toBe('');
    expect(cleanPageText(123 as unknown as string)).toBe('');
    expect(cleanPageText('')).toBe('');
  });
});

describe('pageEmbeddingInput', () => {
  it('prefers the translation and marks it as one', () => {
    const r = pageEmbeddingInput({ translation: { data: 'English words' }, ocr: { data: 'Greek words' } });
    expect(r).toEqual({ text: 'English words', hasTranslation: true });
  });

  it('falls back to OCR for an untranslated original', () => {
    const r = pageEmbeddingInput({ ocr: { data: 'Greek words' } });
    expect(r).toEqual({ text: 'Greek words', hasTranslation: false });
  });

  it('returns null when there is nothing to embed', () => {
    expect(pageEmbeddingInput({})).toBeNull();
    expect(pageEmbeddingInput({ ocr: { data: '<meta>only a note</meta>' } })).toBeNull();
  });
});

describe('buildPageEmbeddingRow', () => {
  const page = {
    id: 'p1', book_id: 'b1', page_number: 42,
    translation: { data: 'text', updated_at: new Date('2026-01-02T00:00:00Z') },
  };
  const book = { title: 'T', author: 'A', language: 'Greek', year: 1831 };

  it('leaves the translation column EMPTY when the text came from OCR', () => {
    // The column feeds surfaces that promise English. Putting original-language
    // OCR in it would leak Greek into an English-only result.
    const row = buildPageEmbeddingRow({ page, book, text: 'Greek', hasTranslation: false, embedding: [1, 2] });
    expect(row.translation).toBe('');
  });

  it('fills the translation column when the text IS a translation', () => {
    const row = buildPageEmbeddingRow({ page, book, text: 'English', hasTranslation: true, embedding: [1, 2] });
    expect(row.translation).toBe('English');
  });

  it('serialises the embedding and stamps the model', () => {
    const row = buildPageEmbeddingRow({ page, book, text: 't', hasTranslation: true, embedding: [0.1, 0.2] });
    expect(row.embedding).toBe('[0.1,0.2]');
    expect(row.embedding_model).toBe(EMBED_MODEL);
  });

  it('carries the Mongo freshness watermark, which --restale compares against', () => {
    const row = buildPageEmbeddingRow({ page, book, text: 't', hasTranslation: true, embedding: [] });
    expect(row.mongo_updated_at).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(row.updated_at).toEqual(new Date('2026-01-02T00:00:00Z'));
  });

  it('tolerates a book row missing its denormalised fields', () => {
    const row = buildPageEmbeddingRow({ page, book: {}, text: 't', hasTranslation: true, embedding: [] });
    expect(row.book_title).toBeNull();
    expect(row.book_year).toBeNull();
  });

  it('emits every column the upsert statement binds', () => {
    const row = buildPageEmbeddingRow({ page, book, text: 't', hasTranslation: true, embedding: [] });
    for (const col of [
      'page_id', 'book_id', 'page_number', 'translation', 'embedding',
      'book_title', 'book_author', 'book_language', 'book_year',
      'updated_at', 'embedding_model', 'mongo_updated_at',
    ]) {
      expect(row, `missing column ${col}`).toHaveProperty(col);
    }
  });
});
