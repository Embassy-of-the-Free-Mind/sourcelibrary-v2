import { describe, it, expect } from 'vitest';
import { ALLOWED_EVENTS, ALLOWED_PROPS } from '@/lib/analytics-event-allowlist';
import {
  readerSharePayload,
  readerCitePayload,
  readerShareLink,
  type ReaderShareMethod,
} from '@/lib/reader-share-events';
import { decodeShortlink } from '@/lib/shortlinks';

/**
 * The reader's copy-link buttons and cite panel report `share` / `cite` (#76).
 *
 * The route answers 200 and drops any prop key not in ALLOWED_PROPS, so a
 * payload that drifts from the allowlist loses its `method` silently and every
 * copy reads as an unattributed share weeks later. These run the real payload
 * builders against the real allowlists (not a source grep).
 * Negative controls checked by hand: removing 'method' from ALLOWED_PROPS, and
 * renaming `method` to `how` in readerSharePayload, each turn this file red.
 */

const SHARE_METHODS: ReaderShareMethod[] = ['copy_link', 'copy_link_ref'];

describe('reader share/cite events survive the analytics allowlist', () => {
  it('both event names are accepted by the route', () => {
    expect(ALLOWED_EVENTS.has('share')).toBe(true);
    expect(ALLOWED_EVENTS.has('cite')).toBe(true);
  });

  it.each(SHARE_METHODS)('share via %s: every prop is persisted and method is carried', (method) => {
    const props = readerSharePayload(method, { url: 'https://sourcelibrary.org/book/x/page/y', page: 12 });
    expect(Object.keys(props).filter((k) => !ALLOWED_PROPS.has(k))).toEqual([]);
    expect(props.method).toBe(method);
    expect(props.surface).toBe('reader');
    expect(props.page).toBe(12);
  });

  it('cite via copy_citation: every prop is persisted and method is carried', () => {
    const props = readerCitePayload('copy_citation', { bookId: 'abc', page: 3 });
    expect(Object.keys(props).filter((k) => !ALLOWED_PROPS.has(k))).toEqual([]);
    expect(props.method).toBe('copy_citation');
    expect(props.bookId).toBe('abc');
  });

  it('a page with no number leaves page out rather than sending null', () => {
    expect(readerSharePayload('copy_link', { url: 'u', page: null }).page).toBeUndefined();
    expect(readerCitePayload('copy_citation', { bookId: 'b', page: undefined }).page).toBeUndefined();
  });
});

describe('readerShareLink (#76)', () => {
  const longUrl = 'https://sourcelibrary.org/book/turba-philosophorum/page/p1';
  const objectId = '65a1b2c3d4e5f60718293a4b';

  it('the main site passes on the /q/ shortlink, which round-trips to the same book and page', () => {
    const link = readerShareLink({ longUrl, bookId: objectId, pageNumber: 12, origin: 'https://sourcelibrary.org', embedded: false });
    expect(link).toMatch(/^https:\/\/sourcelibrary\.org\/q\/[0-9A-Za-z]+$/);
    expect(decodeShortlink(link.split('/q/')[1])).toEqual({ bookId: objectId, pageNumber: 12 });
  });

  it('keeps the current origin, so a preview build links to itself', () => {
    const link = readerShareLink({ longUrl, bookId: objectId, pageNumber: 3, origin: 'https://x.vercel.app', embedded: false });
    expect(link.startsWith('https://x.vercel.app/q/')).toBe(true);
  });

  it('a reading room or iframe keeps its own long link', () => {
    expect(readerShareLink({ longUrl, bookId: objectId, pageNumber: 12, origin: 'https://bph.sourcelibrary.org', embedded: true })).toBe(longUrl);
  });

  it('an id the shortlink cannot encode keeps the long slug link, not an id-based fallback', () => {
    expect(readerShareLink({ longUrl, bookId: 'not-an-objectid', pageNumber: 12, origin: 'https://sourcelibrary.org', embedded: false })).toBe(longUrl);
  });

  it('a Spanish reader passes on the shortlink with ?lang=es; English adds nothing', () => {
    const es = readerShareLink({ longUrl, bookId: objectId, pageNumber: 12, origin: 'https://sourcelibrary.org', embedded: false, lang: 'es' });
    expect(es).toMatch(/^https:\/\/sourcelibrary\.org\/q\/[0-9A-Za-z]+\?lang=es$/);
    const en = readerShareLink({ longUrl, bookId: objectId, pageNumber: 12, origin: 'https://sourcelibrary.org', embedded: false, lang: 'en' });
    expect(en).not.toContain('?lang=');
  });

  it('no page number keeps the long link', () => {
    expect(readerShareLink({ longUrl, bookId: objectId, pageNumber: null, origin: 'https://sourcelibrary.org', embedded: false })).toBe(longUrl);
  });

  it('native_share is a persisted method', () => {
    const props = readerSharePayload('native_share', { url: longUrl, page: 1 });
    expect(Object.keys(props).filter((k) => !ALLOWED_PROPS.has(k))).toEqual([]);
    expect(props.method).toBe('native_share');
  });
});
