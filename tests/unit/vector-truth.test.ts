import { describe, it, expect } from 'vitest';
import {
  assertStoreVector, vectorShapeProblems, e5Signature, cosineClass, wilson, GEMINI_TEXT_MODEL, GEMINI_TEXT_MODELS,
} from '../../scripts/lib/vector-truth.mjs';
import { buildPageEmbeddingRow, buildPageTextRow } from '../../scripts/lib/page-embedding-text.mjs';

// #6175: page_translations held multilingual-e5-base vectors under a 'gemini-embedding-2-preview'
// label that a column DEFAULT supplied. Gemini query vectors cannot reach them, and nothing errors.
// These pin the write-time refusal; the fixture below is a REAL e5 row's shape, not a toy.

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
}
function unit(v: number[]) { const n = Math.hypot(...v); return v.map((x) => x / n); }
/** Isotropic random unit vector — Gemini-like as far as the signature is concerned. */
function geminiLike(seed = 1) { const r = seeded(seed); return unit(Array.from({ length: 768 }, r)); }

describe('e5 signature', () => {
  it('a random (Gemini-like) direction sits near 0', () => {
    for (let s = 1; s < 20; s++) expect(Math.abs(e5Signature(geminiLike(s))!)).toBeLessThan(0.2);
  });
});

describe('assertStoreVector', () => {
  const ok = geminiLike(7);
  it('accepts a unit 768-dim vector from the store model', () => {
    expect(() => assertStoreVector(ok, { model: GEMINI_TEXT_MODEL })).not.toThrow();
  });
  it('refuses a vector whose writer names no model', () => {
    expect(() => assertStoreVector(ok, {} as any)).toThrow(/no model/);
  });
  it('accepts the GA and preview labels for one another (bit-identical vectors, #6170)', () => {
    expect(GEMINI_TEXT_MODEL).toBe('gemini-embedding-2');
    for (const model of GEMINI_TEXT_MODELS) {
      expect(() => assertStoreVector(ok, { model })).not.toThrow();
      expect(() => assertStoreVector(ok, { model: GEMINI_TEXT_MODEL, storeModel: model })).not.toThrow();
    }
    expect(() => assertStoreVector(ok, { model: 'gemini-embedding-001' })).toThrow(/store holds/);
  });
  it('refuses another model', () => {
    expect(() => assertStoreVector(ok, { model: 'multilingual-e5-base' })).toThrow(/store holds/);
  });
  it('refuses wrong dims, NaN, zero and an unnormalised vector', () => {
    expect(vectorShapeProblems(ok.slice(0, 512))).toContain('dims:512');
    expect(vectorShapeProblems([...ok.slice(0, 767), NaN])).toEqual(['nan']);
    expect(vectorShapeProblems(new Array(768).fill(0))).toEqual(['zero']);
    expect(vectorShapeProblems(ok.map((x) => x * 3))[0]).toMatch(/^norm:/);
  });
  it('refuses an e5-shaped vector labelled Gemini (the #6175 row)', async () => {
    // Move a random vector most of the way onto the e5 mean direction: that is what every e5-base
    // vector looks like (measured: 0.85–0.91 from its own mean, Gemini ≤ 0.07).
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('scripts/lib/vector-truth.mjs', 'utf8');
    const centroid = JSON.parse(src.slice(src.indexOf('const E5_CENTROID = [') + 20, src.indexOf('];', src.indexOf('const E5_CENTROID = [')) + 1).replace(/,\s*\]/, ']'));
    const c = unit(centroid);
    const e5 = unit(c.map((x: number, i: number) => 0.9 * x + 0.45 * ok[i]));
    expect(e5Signature(e5)!).toBeGreaterThan(0.8);
    expect(() => assertStoreVector(e5, { model: GEMINI_TEXT_MODEL })).toThrow(/e5-signature/);
  });
});

describe('row builders take the label from the writer', () => {
  const page = { id: 'p1', book_id: 'b1', page_number: 3, translation: { data: 'x', updated_at: new Date() } };
  const vec = geminiLike(3);
  it('page_translations: model is required and is what the row says', () => {
    expect(() => buildPageEmbeddingRow({ page, book: {}, text: 'x', hasTranslation: true, embedding: vec } as any)).toThrow();
    const row = buildPageEmbeddingRow({ page, book: {}, text: 'x', hasTranslation: true, embedding: vec, model: GEMINI_TEXT_MODEL });
    expect(row.embedding_model).toBe(GEMINI_TEXT_MODEL);
  });
  it('page_texts: same', () => {
    const p = { ...page, translations: { es: { data: 'x' } } };
    expect(() => buildPageTextRow({ page: p, book: {}, lang: 'es', text: 'x', embedding: [0.1, 0.2] } as any)).toThrow();
    expect(buildPageTextRow({ page: p, book: {}, lang: 'es', text: 'x', embedding: vec, model: GEMINI_TEXT_MODEL }).embedding_model).toBe(GEMINI_TEXT_MODEL);
  });
});

describe('classes', () => {
  it('cuts at 0.5 and 0.99', () => {
    expect(cosineClass(0.02)).toBe('off-space');
    expect(cosineClass(0.93)).toBe('drifted');
    expect(cosineClass(0.995)).toBe('ok');
    expect(cosineClass(NaN)).toBe('unknown');
  });
  it('wilson brackets the point estimate', () => {
    const [lo, hi] = wilson(14, 389);
    expect(lo).toBeLessThan(14 / 389);
    expect(hi).toBeGreaterThan(14 / 389);
  });
});
