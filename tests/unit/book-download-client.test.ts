import { afterEach, describe, expect, it, vi } from 'vitest';
import { books } from '@/lib/api-client/books';

/**
 * DownloadButton branches on the download response's status: the terms
 * agreement arrives as a 403 `terms_required`, and 401/402/429 have their own
 * answers. The client used to throw on any non-2xx, so none of those branches
 * ran and the agreement never appeared in a real browser (#8098), while the
 * route's own tests passed.
 */
describe('books.download hands a refusal back instead of throwing', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const status of [401, 402, 403, 429]) {
    it(`resolves with the ${status} and its body`, async () => {
      const body = { terms_required: status === 403, error: 'x' };
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);
      const res = await books.download('b', 'ocr', undefined, '2026-11-04');
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('terms=2026-11-04');
    });
  }
});
