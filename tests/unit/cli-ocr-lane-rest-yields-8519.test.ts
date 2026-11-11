/**
 * #8519 REST YIELDS: the Latin re-read's `rest` tier (no readers, outside 1501-1700) runs only while no first read waits
 * for a book readers opened or requested. `readers` and `period` keep their place.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { readerFirstReadBook, restTierOpen, readerFirstReadsWaiting, rereadTier, REREAD_TIERS, REST_YIELD_LANGUAGES } from '../../scripts/batch/cli-ocr-lane.mjs';

const held = (over: Record<string, unknown> = {}) => ({
  id: 'b1', visible: true, pages_count: 300, pages_ocr: 0, language: 'Latin', title: 'Opera omnia', published: '1580',
  image_source: { provider: 'e-rara' }, human_read_count: 3, pipeline_auto: { status: 'held', hold: { reason: 'scans-only-publish-7176' } }, ...over,
});

/** A fake db: `books` rows for find(), `unread` book ids for pages.findOne(), `requests` for feedback.find(). */
function fakeDb({ books = [] as any[], unread = new Set<string>(), requests = [] as any[] }) {
  const calls: string[] = [];
  return {
    calls,
    collection: (name: string) => ({
      find: () => ({ toArray: async () => (name === 'books' ? books : name === 'feedback' ? requests : []) }),
      findOne: async (q: { book_id: string }) => { calls.push(q.book_id); return unread.has(q.book_id) ? { _id: 'p' } : null; },
    }),
  };
}

describe('the rest tier yields to first reads readers want (#8519)', () => {
  it('a book readers opened, in the first-read frame, counts', () => {
    expect(readerFirstReadBook(held())).toBe(true);
  });
  it('a book nobody opened counts only when requested (by id or _id)', () => {
    const b = held({ human_read_count: 0, _id: 'abcabcabcabcabcabcabcabc' });
    expect(readerFirstReadBook(b)).toBe(false);
    expect(readerFirstReadBook(b, { requested: new Set(['b1']) })).toBe(true);
    expect(readerFirstReadBook(b, { requested: new Set(['abcabcabcabcabcabcabcabc']) })).toBe(true);
  });
  it('a book no scheduled first-read lane reads does not hold the rest tier', () => {
    expect(readerFirstReadBook(held({ language: 'Italian' }))).toBe(false);        // not in REST_YIELD_LANGUAGES
    expect(readerFirstReadBook(held({ pipeline_auto: { status: 'archive_complete' } }))).toBe(false); // the pipeline owns it
    expect(readerFirstReadBook(held({ visible: false }))).toBe(false);
    expect(REST_YIELD_LANGUAGES).toEqual(['lat', 'deu', 'fra']);
  });
  it('restTierOpen: shut while a first read waits, open when none does', () => {
    expect(restTierOpen({ first: 'b1', books: 2, pages_est: 40 })).toMatchObject({ open: false });
    expect(restTierOpen({ first: 'b1', books: 2, pages_est: 40 }).why).toMatch(/b1/);
    expect(restTierOpen({ first: null, books: 2, pages_est: 0 })).toMatchObject({ open: true });
  });
  it('readerFirstReadsWaiting checks most-read first and stops at the first book with an unread page', async () => {
    const db = fakeDb({
      books: [held({ id: 'few', human_read_count: 1 }), held({ id: 'many', human_read_count: 9 }), held({ id: 'mid', human_read_count: 4 }), held({ id: 'it', language: 'Italian' })],
      unread: new Set(['mid', 'few']),
    });
    const w = await readerFirstReadsWaiting(db);
    expect(w.first).toBe('mid');
    expect(db.calls).toEqual(['many', 'mid']);     // stopped at mid; never looked at 'few'; 'it' not a candidate
    expect(w.books).toBe(3);
    expect(w.pages_est).toBe(900);
  });
  it('no candidate with an unread page leaves the rest tier open', async () => {
    const w = await readerFirstReadsWaiting(fakeDb({ books: [held()], unread: new Set() }));
    expect(restTierOpen(w).open).toBe(true);
  });
  it('an id the request names is matched though nobody opened the book', async () => {
    const db = fakeDb({ books: [held({ human_read_count: 0 })], unread: new Set(['b1']), requests: [{ page: 'https://sourcelibrary.org/book/b1/page/p9' }] });
    expect((await readerFirstReadsWaiting(db)).first).toBe('b1');
  });
  it('the tiers themselves are unchanged: readers, period, rest', () => {
    expect(REREAD_TIERS).toEqual(['readers', 'period', 'rest']);
    expect(rereadTier({ human_read_count: 2, year: 1800 })).toBe('readers');
    expect(rereadTier({ year: 1600 })).toBe('period');
    expect(rereadTier({ year: 1800 })).toBe('rest');
  });
});
