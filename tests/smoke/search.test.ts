/**
 * Search smoke tests — hit production API endpoints to verify search behavior.
 * Run with: npx vitest run tests/smoke/search.test.ts
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_BASE_URL || 'https://sourcelibrary.org';

async function fetchJson(path: string) {
  const res = await fetch(`${BASE}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}

describe('Unified search (/api/search/unified)', () => {
  it('returns books for a common term', async () => {
    const data = await fetchJson('/api/search/unified?q=alchemy&limit=5');
    expect(data.books.results.length).toBeGreaterThan(0);
    expect(data.books.results[0]).toHaveProperty('title');
    expect(data.books.results[0]).toHaveProperty('thumbnail');
  });

  it('returns index results for a known entity', async () => {
    const data = await fetchJson('/api/search/unified?q=Paracelsus&limit=5');
    expect(data.index.results.length).toBeGreaterThan(0);
    expect(data.index.results[0]).toHaveProperty('term');
  });

  it('strips quotes for semantic/visual search', async () => {
    const data = await fetchJson('/api/search/unified?q=%22transmutation+of+metals%22&limit=5');
    // Should not error — quotes are stripped before passing to subsystems
    expect(data).toHaveProperty('query');
  });

  it('skips index search for quoted phrases', async () => {
    const data = await fetchJson('/api/search/unified?q=%22venus+humanitas%22&limit=5');
    // Quoted phrases should skip entity autocomplete (too loose)
    expect(data.index.results.length).toBe(0);
  });

  it('returns collections for matching terms', async () => {
    const data = await fetchJson('/api/search/unified?q=alchemy&limit=5');
    expect(data).toHaveProperty('collections');
  });
});

describe('Global search (/api/search)', () => {
  it('returns book and page results', async () => {
    const data = await fetchJson('/api/search?q=alchemy&limit=10&search_content=true');
    expect(data.total).toBeGreaterThan(0);
    const types = new Set(data.results.map((r: any) => r.type));
    expect(types.has('book')).toBe(true);
  });

  it('finds page content with quoted phrases', async () => {
    const data = await fetchJson('/api/search?q=%22transmutation+of+metals%22&limit=10&search_content=true');
    expect(data.total).toBeGreaterThan(0);
    // Should find pages where this exact phrase appears
    const pages = data.results.filter((r: any) => r.type === 'page');
    expect(pages.length).toBeGreaterThan(0);
  });

  it('strips quotes from snippet extraction', async () => {
    const data = await fetchJson('/api/search?q=%22transmutation+of+metals%22&limit=5&search_content=true');
    for (const r of data.results) {
      if (r.snippet) {
        // Snippets should not contain raw XML tags
        expect(r.snippet).not.toMatch(/<note>/);
        expect(r.snippet).not.toMatch(/<\/note>/);
      }
    }
  });

  it('returns thumbnails for book results', async () => {
    const data = await fetchJson('/api/search?q=ficino&limit=5');
    const books = data.results.filter((r: any) => r.type === 'book');
    expect(books.length).toBeGreaterThan(0);
    // At least some books should have thumbnails
    const withThumbs = books.filter((b: any) => b.thumbnail || b.thumbnail_blob);
    expect(withThumbs.length).toBeGreaterThan(0);
  });
});

describe('Semantic search (/api/search/semantic)', () => {
  it('returns valid response shape', async () => {
    const data = await fetchJson('/api/search/semantic?q=hermes+trismegistus&limit=5');
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('query');
    expect(Array.isArray(data.results)).toBe(true);
    // If results come back, verify enrichment
    if (data.results.length > 0) {
      expect(data.results[0]).toHaveProperty('thumbnail');
      expect(data.results[0]).toHaveProperty('slug');
    }
  });

  it('strips quotes before embedding', async () => {
    const data = await fetchJson('/api/search/semantic?q=%22philosopher+stone%22&limit=5');
    // Should not error — quotes stripped before Gemini embedding call
    expect(data).toHaveProperty('results');
  });
});

describe('Within-book search (/api/books/[id]/search)', () => {
  // Ficino's Complete Works
  const FICINO_ID = '694b3abfde93d1d4cec196fd';

  it('finds keyword matches', async () => {
    const data = await fetchJson(`/api/books/${FICINO_ID}/search?q=Venus`);
    expect(data.total).toBeGreaterThan(0);
    expect(data.results[0]).toHaveProperty('pageNumber');
    expect(data.results[0]).toHaveProperty('matches');
  });

  it('handles quoted phrase search', async () => {
    const data = await fetchJson(`/api/books/${FICINO_ID}/search?q=%22mother+of+the+Graces%22`);
    // Should find exact phrase or return 0 — not error
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('results');
  });

  it('snippets are clean (no XML tags)', async () => {
    const data = await fetchJson(`/api/books/${FICINO_ID}/search?q=Venus`);
    for (const result of data.results.slice(0, 5)) {
      for (const match of result.matches) {
        expect(match.snippet).not.toMatch(/<note>/);
        expect(match.snippet).not.toMatch(/<\/note>/);
        expect(match.snippet).not.toMatch(/<meta>/);
      }
    }
  });

  it('snippets are capped in length', async () => {
    const data = await fetchJson(`/api/books/${FICINO_ID}/search?q=Venus`);
    for (const result of data.results.slice(0, 5)) {
      for (const match of result.matches) {
        // Snippets should not be entire page content
        expect(match.snippet.length).toBeLessThan(500);
      }
    }
  });
});
