/**
 * reader-request-lane (#7599): the request URL parse, the hold allowlist, and the reply a reader receives.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseRequestUrl, requestTitle, replyText, LANE_HOLDS } from '../../scripts/batch/reader-request-lane.mjs';

describe('reader-request-lane', () => {
  it('parses the page URL a request carries, with or without host and query', () => {
    expect(parseRequestUrl('https://sourcelibrary.org/book/abc/page/def?x=1')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc/page/def#t')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc')).toBeNull();
    expect(parseRequestUrl(undefined)).toBeNull();
  });

  it('allows only waiting-for-a-lane holds, never a containment', () => {
    expect(LANE_HOLDS).toContain('ocr-flash-cli-7075');
    expect(LANE_HOLDS).toContain('translate-cli-7075');
    for (const r of LANE_HOLDS) expect(r).not.toMatch(/contain|invent|wrong-leaf|awaits|fabricat|poison/);
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
