/**
 * Withdrawn collections must answer 410 Gone, and only the exact collection
 * page. Exercised through `proxy()` itself rather than by asserting the source
 * shape — the point is the status code a visitor receives.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { retiredCollectionMessage, RETIRED_COLLECTIONS } from '@/lib/retired-collections';

const req = (url: string) => new NextRequest(new Request(url));

describe('retiredCollectionMessage', () => {
  it('matches the retired collection page, with or without a trailing slash', () => {
    expect(retiredCollectionMessage('/collections/kloss-collection')).toBeTruthy();
    expect(retiredCollectionMessage('/collections/kloss-collection/')).toBeTruthy();
  });

  it('leaves live collections and deeper paths alone', () => {
    expect(retiredCollectionMessage('/collections/hermetica')).toBeNull();
    expect(retiredCollectionMessage('/collections')).toBeNull();
    // A deeper path under a retired slug is a different resource.
    expect(retiredCollectionMessage('/collections/kloss-collection/books')).toBeNull();
    // Must not fire on a slug that merely contains the retired one.
    expect(retiredCollectionMessage('/collections/kloss-collection-2')).toBeNull();
  });

  it('says nothing about why, or about anyone involved', () => {
    // A proxy response is not the place to characterise a takedown request.
    for (const message of Object.values(RETIRED_COLLECTIONS)) {
      expect(message).not.toMatch(/copyright|takedown|dmca|request|legal|estate|heir/i);
    }
  });
});

describe('proxy() on a retired collection', () => {
  it('returns 410 Gone, not 404', async () => {
    const res = await proxy(req('https://sourcelibrary.org/collections/kloss-collection'));
    expect(res?.status).toBe(410);
    expect(res?.headers.get('x-robots-tag')).toContain('noindex');
    expect(await res!.text()).toContain('no longer available');
  });

  it('applies on a partner subdomain too', async () => {
    const res = await proxy(req('https://bph.sourcelibrary.org/collections/kloss-collection'));
    expect(res?.status).toBe(410);
  });

  it('does not intercept a live collection', async () => {
    const res = await proxy(req('https://sourcelibrary.org/collections/hermetica'));
    expect(res?.status).not.toBe(410);
  });
});
