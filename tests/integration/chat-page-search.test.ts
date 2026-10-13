/**
 * #5220: the chat page-search fallback must score every matching page, not
 * the first `limit * 10` in page order. Runs the real aggregation against
 * mongodb-memory-server.
 */
import { getTestDb, cleanDb } from '../setup';
import { searchChatPages } from '@/lib/chat-page-search';

const BOOK = 'book-5220';

function page(n: number, text: string, extra: Record<string, unknown> = {}) {
  return { id: `${BOOK}-p${n}`, book_id: BOOK, page_number: n, translation: { data: text }, ocr: { data: 'x'.repeat(50) }, ...extra };
}

describe('searchChatPages (#5220)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('finds the only strong match on page 380 of 400, past 150 weaker earlier matches', async () => {
    const db = getTestDb();
    const pages = [];
    for (let n = 1; n <= 400; n++) {
      if (n === 380) pages.push(page(n, 'The salamander, the salamander, the salamander lives in fire.'));
      else if (n <= 200) pages.push(page(n, 'A passing mention of fire.'));
      else pages.push(page(n, 'Nothing relevant here.'));
    }
    await db.collection('pages').insertMany(pages);

    const hits = await searchChatPages(db, { book_id: BOOK }, ['salamander', 'fire'], 15);
    expect(hits).toHaveLength(15);
    expect(hits[0].page_number).toBe(380);
    // Ties (score 1) fall back to page order, as the old stable sort did.
    expect(hits.slice(1).map(h => h.page_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('returns a page whose only match is on page 380', async () => {
    const db = getTestDb();
    const pages = [];
    for (let n = 1; n <= 400; n++) pages.push(page(n, n === 380 ? 'On the Salamander.' : 'Filler text.'));
    await db.collection('pages').insertMany(pages);

    const hits = await searchChatPages(db, { book_id: BOOK }, ['salamander'], 15);
    expect(hits.map(h => h.page_number)).toEqual([380]);
  });

  it('projects only the fields the context builder reads, and respects scope', async () => {
    const db = getTestDb();
    await db.collection('pages').insertMany([
      page(1, 'fire fire', { tenantId: 'bph' }),
      page(2, 'fire', { tenantId: 'other' }),
      page(3, 'fire', { tenantId: 'bph', translation: { data: 42 } }),
    ]);

    const hits = await searchChatPages(db, { book_id: BOOK, tenantId: 'bph' }, ['fire'], 15);
    expect(hits.map(h => h.page_number)).toEqual([1]);
    expect(Object.keys(hits[0]).sort()).toEqual(['book_id', 'id', 'page_number', 'translation']);
  });

  it('with no keywords returns the first pages in order', async () => {
    const db = getTestDb();
    await db.collection('pages').insertMany([page(3, 'c'), page(1, 'a'), page(2, 'b')]);
    const hits = await searchChatPages(db, { book_id: BOOK }, [], 2);
    expect(hits.map(h => h.page_number)).toEqual([1, 2]);
  });
});
