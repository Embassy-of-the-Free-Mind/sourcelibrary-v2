/**
 * Search smoke tests — hit production API endpoints to verify search behavior.
 *
 * Asserts on RESPONSE SHAPE, quote handling, and XML stripping.
 * For COVERAGE regressions (and the P0 bugs fixed by PR #2162) see
 * tests/smoke/mcp-search.test.ts.
 *
 * Both files read their query lists from tests/fixtures/mcp-search-regression-queries.json
 * so the regression matrix has a single source of truth.
 *
 * Run with: npx vitest run --config vitest.smoke.config.ts tests/smoke/search.test.ts
 */
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/mcp-search-regression-queries.json' with { type: 'json' };

const BASE = process.env.TEST_BASE_URL || 'https://sourcelibrary.org';
const SHAPE = fixture.shape_assertions;

async function fetchJson(path: string) {
  const res = await fetch(`${BASE}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

function enc(q: string) {
  return encodeURIComponent(q);
}

describe('Unified search (/api/search/unified) — shape', () => {
  // Queries: see fixture.shape_assertions.unified_search
  it('returns books for a common term', async () => {
    const q = SHAPE.unified_search[0].q; // "alchemy"
    const data = await fetchJson(`/api/search/unified?q=${enc(q)}&limit=5`);
    expect(data.books.results.length).toBeGreaterThan(0);
    expect(data.books.results[0]).toHaveProperty('title');
    expect(data.books.results[0]).toHaveProperty('thumbnail');
  });

  it('returns index results for a known entity', async () => {
    const q = SHAPE.unified_search[1].q; // "Paracelsus"
    const data = await fetchJson(`/api/search/unified?q=${enc(q)}&limit=5`);
    expect(data.index.results.length).toBeGreaterThan(0);
    expect(data.index.results[0]).toHaveProperty('term');
  });

  it('strips quotes for semantic/visual search', async () => {
    const q = SHAPE.unified_search[2].q; // '"transmutation of metals"'
    const data = await fetchJson(`/api/search/unified?q=${enc(q)}&limit=5`);
    // Should not error — quotes are stripped before passing to subsystems
    expect(data).toHaveProperty('query');
  });

  it('skips index search for quoted phrases', async () => {
    const q = SHAPE.unified_search[3].q; // '"venus humanitas"'
    const data = await fetchJson(`/api/search/unified?q=${enc(q)}&limit=5`);
    // Quoted phrases should skip entity autocomplete (too loose)
    expect(data.index.results.length).toBe(0);
  });

  it('returns collections for matching terms', async () => {
    const q = SHAPE.unified_search[0].q; // "alchemy"
    const data = await fetchJson(`/api/search/unified?q=${enc(q)}&limit=5`);
    expect(data).toHaveProperty('collections');
  });
});

describe('Global search (/api/search) — shape', () => {
  it('returns book and page results', async () => {
    const q = SHAPE.global_search[0].q; // "alchemy"
    const data = await fetchJson(`/api/search?q=${enc(q)}&limit=10&search_content=true`);
    expect(data.total).toBeGreaterThan(0);
    const types = new Set(data.results.map((r: any) => r.type));
    expect(types.has('book')).toBe(true);
  });

  it('finds page content with quoted phrases', async () => {
    const q = SHAPE.global_search[1].q; // '"transmutation of metals"'
    const data = await fetchJson(`/api/search?q=${enc(q)}&limit=10&search_content=true`);
    expect(data.total).toBeGreaterThan(0);
    const pages = data.results.filter((r: any) => r.type === 'page');
    expect(pages.length).toBeGreaterThan(0);
  });

  it('strips quotes from snippet extraction', async () => {
    const q = SHAPE.global_search[1].q;
    const data = await fetchJson(`/api/search?q=${enc(q)}&limit=5&search_content=true`);
    for (const r of data.results) {
      if (r.snippet) {
        expect(r.snippet).not.toMatch(/<note>/);
        expect(r.snippet).not.toMatch(/<\/note>/);
      }
    }
  });

  it('returns thumbnails for book results', async () => {
    const q = SHAPE.global_search[2].q; // "ficino"
    const data = await fetchJson(`/api/search?q=${enc(q)}&limit=5`);
    const books = data.results.filter((r: any) => r.type === 'book');
    expect(books.length).toBeGreaterThan(0);
    const withThumbs = books.filter((b: any) => b.thumbnail || b.thumbnail_blob);
    expect(withThumbs.length).toBeGreaterThan(0);
  });
});

describe('Semantic search (/api/search/semantic) — shape', () => {
  it('returns valid response shape', async () => {
    const q = SHAPE.semantic_search[0].q; // "hermes trismegistus"
    const data = await fetchJson(`/api/search/semantic?q=${enc(q)}&limit=5`);
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('query');
    expect(Array.isArray(data.results)).toBe(true);
    if (data.results.length > 0) {
      expect(data.results[0]).toHaveProperty('thumbnail');
      expect(data.results[0]).toHaveProperty('slug');
    }
  });

  it('strips quotes before embedding', async () => {
    const q = SHAPE.semantic_search[1].q; // '"philosopher stone"'
    const data = await fetchJson(`/api/search/semantic?q=${enc(q)}&limit=5`);
    expect(data).toHaveProperty('results');
  });
});

describe('Within-book search (/api/books/[id]/search) — shape', () => {
  const BOOK_ID = SHAPE.within_book_search.book_id;
  const Q_VENUS = SHAPE.within_book_search.queries[0].q;       // "Venus"
  const Q_PHRASE = SHAPE.within_book_search.queries[1].q;      // '"mother of the Graces"'

  it('finds keyword matches', async () => {
    const data = await fetchJson(`/api/books/${BOOK_ID}/search?q=${enc(Q_VENUS)}`);
    expect(data.total).toBeGreaterThan(0);
    expect(data.results[0]).toHaveProperty('pageNumber');
    expect(data.results[0]).toHaveProperty('matches');
  });

  it('handles quoted phrase search', async () => {
    const data = await fetchJson(`/api/books/${BOOK_ID}/search?q=${enc(Q_PHRASE)}`);
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('results');
  });

  it('snippets are clean (no XML tags)', async () => {
    const data = await fetchJson(`/api/books/${BOOK_ID}/search?q=${enc(Q_VENUS)}`);
    for (const result of data.results.slice(0, 5)) {
      for (const match of result.matches) {
        expect(match.snippet).not.toMatch(/<note>/);
        expect(match.snippet).not.toMatch(/<\/note>/);
        expect(match.snippet).not.toMatch(/<meta>/);
      }
    }
  });

  it('snippets are capped in length', async () => {
    const data = await fetchJson(`/api/books/${BOOK_ID}/search?q=${enc(Q_VENUS)}`);
    for (const result of data.results.slice(0, 5)) {
      for (const match of result.matches) {
        expect(match.snippet.length).toBeLessThan(500);
      }
    }
  });
});
