import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const insertOne = vi.fn();
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: () => ({ insertOne }) }),
}));
vi.mock('@/lib/partner-embed-download-server', () => ({
  anonymousDownloadCapKey: () => 'anon-ip:hash',
}));

import { POST } from '@/app/api/terms/accept/route';
import {
  READER_TERMS_FALLBACK_PATH,
  READER_TERMS_VERSION,
  pathFromSameOriginUrl,
  readerTermsReturnPath,
} from '@/lib/reader-terms';

const ORIGIN = 'https://sourcelibrary.org';

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}/api/terms/accept`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, ...headers },
  });
}

describe('readerTermsReturnPath', () => {
  it('keeps deep book pages, localized forms and their query', () => {
    expect(readerTermsReturnPath('/book/kircher/page/abc')).toBe('/book/kircher/page/abc');
    expect(readerTermsReturnPath('/es/book/kircher/page/abc?cite=1')).toBe('/es/book/kircher/page/abc?cite=1');
  });

  it.each([
    'https://evil.example/book/a/page/b',
    '//evil.example/book/a/page/b',
    '/\\evil.example/book/a/page/b',
    '/account',
    '/book/a',
    null,
  ])('sends %s to the fallback, because only a same-site reader page may be a target', (candidate) => {
    expect(readerTermsReturnPath(candidate)).toBe(READER_TERMS_FALLBACK_PATH);
  });
});

describe('pathFromSameOriginUrl', () => {
  it('reads our own origin and refuses another', () => {
    expect(pathFromSameOriginUrl(`${ORIGIN}/book/a/page/b?x=1`, ORIGIN)).toBe('/book/a/page/b?x=1');
    expect(pathFromSameOriginUrl('https://evil.example/book/a/page/b', ORIGIN)).toBeNull();
    expect(pathFromSameOriginUrl('not a url', ORIGIN)).toBeNull();
  });
});

describe('POST /api/terms/accept', () => {
  beforeEach(() => insertOne.mockReset());

  it('records the agreement, sets the cookie and returns to the page', async () => {
    const res = await POST(post({ agree: 'on', next: '/book/a/page/b' }, { 'user-agent': 'Browser' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/book/a/page/b`);
    expect(res.headers.get('set-cookie')).toContain(`sl_terms=${READER_TERMS_VERSION}`);
    expect(insertOne.mock.calls[0][0]).toMatchObject({
      terms_version: READER_TERMS_VERSION,
      path: '/book/a/page/b',
      client_key: 'anon-ip:hash',
      user_agent: 'Browser',
    });
  });

  it('falls back to the Referer for a browser that ran no JavaScript', async () => {
    const res = await POST(post({ agree: 'on' }, { referer: `${ORIGIN}/book/a/page/b` }));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/book/a/page/b`);
  });

  it('gives no cookie and no record when the box was not ticked', async () => {
    const res = await POST(post({ next: '/book/a/page/b' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('refuses a form sent from another site, so nobody can agree on a visitor\'s behalf', async () => {
    const res = await POST(post({ agree: 'on' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('still lets the reader through when the record cannot be written', async () => {
    insertOne.mockRejectedValueOnce(new Error('mongo down'));
    const res = await POST(post({ agree: 'on', next: '/book/a/page/b' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain('sl_terms=');
  });
});
