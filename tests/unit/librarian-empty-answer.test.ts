import { describe, it, expect } from 'vitest';
import { emptyAnswerFallback, type SourceCard } from '@/lib/embassy/librarian';

// 48 of 2,328 Librarian answers over 45 days persisted as blank prose with a
// full source list (#4704). When the model writes nothing, the reader now gets
// the retrieved pages as page-level links instead of an empty bubble.
const card = (over: Partial<SourceCard>): SourceCard => ({
  book_id: 'abc123',
  bookTitle: 'Amphitheatrum Sapientiae Aeternae',
  bookAuthor: 'Heinrich Khunrath',
  bookSlug: 'amphitheatrum-sapientiae-aeternae-khunrath',
  pageNumber: 299,
  inCollection: true,
  ...over,
});

describe('emptyAnswerFallback', () => {
  it('lists retrieved pages as page-number links, capped at six', () => {
    const sources = Array.from({ length: 9 }, (_, i) => card({ pageNumber: 10 + i }));
    const text = emptyAnswerFallback(sources, 'en');
    expect(text).toMatch(/couldn't compose the answer/);
    const links = text.match(/\/page-number\/\d+/g) ?? [];
    expect(links).toHaveLength(6);
    expect(text).toContain('https://sourcelibrary.org/book/amphitheatrum-sapientiae-aeternae-khunrath/page-number/10');
    expect(text).toContain('*Amphitheatrum Sapientiae Aeternae* — Heinrich Khunrath');
  });

  it('falls back to the book id when a source has no slug, and skips pageless sources', () => {
    const text = emptyAnswerFallback([
      card({ bookSlug: undefined }),
      card({ pageNumber: undefined, bookSlug: 'no-page' }),
    ]);
    expect(text).toContain('/book/abc123/page-number/299');
    expect(text).not.toContain('no-page');
  });

  it('keeps the Spanish reader in the Spanish chrome', () => {
    const text = emptyAnswerFallback([card({})], 'es');
    expect(text).toMatch(/no logré redactar/);
    expect(text).toContain('https://sourcelibrary.org/es/book/');
    expect(text).toContain('[Página 299]');
  });

  it('still says something when nothing at all was retrieved', () => {
    expect(emptyAnswerFallback([], 'en')).toMatch(/Ask again in other words/);
  });
});
