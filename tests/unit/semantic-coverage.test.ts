import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A semantic blank must be distinguishable from an absent passage.
 *
 * Measured 2026-08-07 across 150 sampled visible books with >20 translated
 * pages: 53% fully embedded, 22% under a quarter, 23% with ZERO rows in
 * `page_translations`. Two of the volumes a reader spent a day searching were
 * among the blind ones — Taylor's 1801 Metaphysics at 10 of 520 pages, the 1551
 * Aldine at 10 of 708 — and they concluded the corpus was thin on exactly the
 * passages they wanted. It was not; the vectors were missing.
 */

const selectMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

const { semanticCoverage } = await import('@/lib/semantic-coverage');

/** Mirror the supabase-js chain: .select(...).eq(...) resolves to {count,error}. */
const respond = (result: { count?: number | null; error?: unknown }) => {
  selectMock.mockReturnValue({ eq: () => Promise.resolve(result) });
};

beforeEach(() => selectMock.mockReset());

describe('semanticCoverage', () => {
  it('reports none, with a caveat, when the book has no vectors', async () => {
    respond({ count: 0 });
    const c = await semanticCoverage('book1', 520);
    expect(c.status).toBe('none');
    expect(c.embedded_pages).toBe(0);
    expect(c.caveat).toBeDefined();
  });

  it('tells the caller NOT to report the passage as missing', async () => {
    // The whole point. An agent reading an empty semantic result on an
    // unembedded book will otherwise tell the user the text does not contain it.
    respond({ count: 0 });
    const c = await semanticCoverage('book1', 520);
    expect(c.caveat).toMatch(/not evidence/i);
    expect(c.caveat).toMatch(/do not tell the user/i);
  });

  it('reports partial when most of the book is unembedded', async () => {
    // Taylor's 1801 Metaphysics as measured: 10 of 520.
    respond({ count: 10 });
    const c = await semanticCoverage('book1', 520);
    expect(c.status).toBe('partial');
    expect(c.caveat).toMatch(/inconclusive/i);
  });

  it('reports full and NO caveat when the book is properly embedded', async () => {
    respond({ count: 407 });
    const c = await semanticCoverage('book1', 407);
    expect(c.status).toBe('full');
    expect(c.caveat).toBeUndefined();
  });

  it('treats a small surplus as full, not partial', async () => {
    // Untranslated originals get an OCR-derived vector, so the vector count can
    // legitimately exceed Mongo's translated-page count (Congreve: 570 vs 565).
    respond({ count: 570 });
    expect((await semanticCoverage('book1', 565)).status).toBe('full');
  });

  it('degrades to unknown rather than throwing when Supabase errors', async () => {
    // A coverage lookup must never be able to fail a search that already has
    // perfectly good keyword results.
    respond({ error: { message: 'connection reset' } });
    const c = await semanticCoverage('book1', 100);
    expect(c.status).toBe('unknown');
    expect(c.caveat).toBeUndefined();
  });

  it('degrades to unknown when the request rejects', async () => {
    // The realistic outage shape: the query rejects rather than returning an
    // error field. Must still not propagate — see above.
    selectMock.mockReturnValue({ eq: () => Promise.reject(new Error('ECONNRESET')) });
    expect((await semanticCoverage('book1', 100)).status).toBe('unknown');
  });

  it('does not divide by zero on a book with no translated pages', async () => {
    respond({ count: 3 });
    const c = await semanticCoverage('book1', 0);
    expect(c.status).toBe('full');
    expect(Number.isFinite(c.embedded_pages)).toBe(true);
  });
});
