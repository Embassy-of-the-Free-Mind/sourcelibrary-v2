/**
 * A catalogue row must not offer a book no visitor can open (#8047).
 */
import { describe, it, expect } from 'vitest';
import { bookIdsNamedBy, withReadableBookLinks } from '@/lib/bph-catalog-book-links';

const hidden = { ubn: '19198', sl_book_id: 'a', sl_book_slug: 'held', sl_external_book_id: null };
const shown = { ubn: '5101', sl_book_id: 'b', sl_book_slug: 'ok' };
const external = { ubn: '4228', sl_book_id: null, sl_external_book_id: 'c', sl_external_slug: 'kloss', sl_external_source: 'cmc_kloss' };

describe('bookIdsNamedBy', () => {
  it('collects both kinds of link, once each', () => {
    expect(bookIdsNamedBy([hidden, shown, external, { ...shown }]).sort()).toEqual(['a', 'b', 'c']);
  });
  it('tolerates a legacy row with no link columns', () => {
    expect(bookIdsNamedBy([{ ubn: '1', title: 'x' }])).toEqual([]);
  });
});

describe('withReadableBookLinks', () => {
  const readable = new Map([['b', 'https://images.example/b.jpg']]);

  it('removes the link and shows no cover for a hidden book', () => {
    const row = withReadableBookLinks(hidden, readable);
    expect(row.sl_book_id).toBeNull();
    expect(row.sl_book_slug).toBeNull();
    expect(row.sl_cover).toBeUndefined();
    expect(row.ubn).toBe('19198');
  });
  it('keeps the link and adds the cover for a readable book', () => {
    expect(withReadableBookLinks(shown, readable)).toMatchObject({ sl_book_id: 'b', sl_book_slug: 'ok', sl_cover: 'https://images.example/b.jpg' });
  });
  it('removes an external scan that cannot be opened', () => {
    expect(withReadableBookLinks(external, readable)).toMatchObject({ sl_external_book_id: null, sl_external_slug: null, sl_external_source: null });
  });
  it('removes every link when the lookup failed (empty map)', () => {
    expect(withReadableBookLinks(shown, new Map()).sl_book_id).toBeNull();
  });
  it('does not change the input row', () => {
    withReadableBookLinks(hidden, readable);
    expect(hidden.sl_book_id).toBe('a');
  });
});
