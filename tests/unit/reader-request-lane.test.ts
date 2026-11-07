/**
 * reader-request-lane (#7599): the request URL parse, the hold allowlist, and the reply a reader receives.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseRequestUrl, requestTitle, replyText, judgeRequest, requestedFirst, LANE_HOLDS, BOOK_CEILING } from '../../scripts/batch/reader-request-lane.mjs';

describe('reader-request-lane', () => {
  it('parses the page URL a request carries, with or without host and query', () => {
    expect(parseRequestUrl('https://sourcelibrary.org/book/abc/page/def?x=1')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc/page/def#t')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc')).toBeNull();
    expect(parseRequestUrl(undefined)).toBeNull();
    expect(parseRequestUrl('/book/abc/page/%E0%A4%A')).toBeNull(); // a public write: a bad escape must not throw
  });

  describe('a request on a Siku-held book (#7690)', () => {
    const held = (reason: string, o = {}) => ({ id: 'b1', visible: true, pages_count: 171, pipeline_auto: { status: 'held', hold: { reason } }, ...o });
    const page = { id: 'p1', page_number: 6, page_type: 'text', ocr: { data: '欽定四庫全書 類說卷三十三 '.repeat(5) } };
    const judge = (o: Record<string, unknown>) => judgeRequest({ page, tail: 171, ceiling: BOOK_CEILING, ...o });

    it('is queued for the Siku lane, under every hold that lane owns, and never worked here', () => {
      for (const r of ['paddle-zh-5600-ocr-only', 'gpu-backlog-5660', 'zh-histories-7546']) {
        expect(judge({ book: held(r) }).verdict).toBe('siku');
      }
    });
    it('still refuses a hold that is not a lane\'s, and a dark Siku book', () => {
      expect(judge({ book: held('jabir-ocr-gate-7341') })).toMatchObject({ verdict: 'refuse', reason: 'book is on pipeline hold' });
      expect(judge({ book: held('paddle-zh-5600-ocr-only', { visible: false, hidden_reason: 'duplicate' }) }).verdict).toBe('refuse');
    });
    it('refuses a Siku page with no OCR, because that lane does not OCR; another lane\'s book still OCRs first', () => {
      const noOcr = { ...page, ocr: {} };
      expect(judge({ book: held('paddle-zh-5600-ocr-only'), page: noOcr }).verdict).toBe('refuse');
      expect(judge({ book: held('scans-only-publish-7176'), page: noOcr }).verdict).toBe('auto');
    });
    it('answers a Siku page that already has English, and sends a repeat to a person, as for any book', () => {
      expect(judge({ book: held('gpu-backlog-5660'), page: { ...page, translation: { data: 'x'.repeat(40) } } }).verdict).toBe('done');
      expect(judge({ book: held('gpu-backlog-5660'), repeat: 'repeat: x' }).verdict).toBe('human');
    });
  });

  it('allows only waiting-for-a-lane holds, never a containment', () => {
    expect(LANE_HOLDS).toContain('ocr-flash-cli-7075');
    expect(LANE_HOLDS).toContain('translate-cli-7075');
    for (const r of LANE_HOLDS) expect(r).not.toMatch(/contain|invent|wrong-leaf|awaits|fabricat|poison/);
  });

  it('puts the requested pages first and keeps the rest in order', () => {
    const pages = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
    expect(requestedFirst(pages, new Set(['p3'])).map((p: { id: string }) => p.id)).toEqual(['p3', 'p1', 'p2', 'p4']);
  });

  it('takes the title from the request prompt, shortened at the first sentence when long', () => {
    expect(requestTitle('Translation requested for "Turris Babel" (page 101)')).toBe('Turris Babel');
    expect(requestTitle('no title here')).toBe('the book');
    const long = `${'A'.repeat(50)}. ${'B'.repeat(50)}`;
    expect(requestTitle(`Translation requested for "${long}" (page 1)`)).toBe('A'.repeat(50));
  });

  it('says the book is done, or underway only when the lane is on it, and links other editions only when not done', () => {
    const base = { title: 'T', pageNumber: 9 };
    expect(replyText({ ...base, bookDone: true, editions: [{ year: 1584, url: 'u' }] })).toBe('The page you asked about in "T" (page 9) now has an English translation. The whole book now has an English translation.');
    expect(replyText({ ...base, bookDone: false, underway: false })).toBe('The page you asked about in "T" (page 9) now has an English translation.');
    expect(replyText({ ...base, bookDone: false, underway: true, alsoPages: [19] })).toMatch(/Page 19, which you also asked about, is translated too\. We are transcribing and translating the rest/);
    expect(replyText({ ...base, bookDone: false, editions: [{ year: 1584, url: 'a' }, { year: 1637, url: 'b' }] })).toMatch(/Other editions of the same work are already readable in English: 1584 \(a\) and 1637 \(b\)\./);
  });
});
