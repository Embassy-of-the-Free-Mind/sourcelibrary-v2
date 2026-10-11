import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { rateLimitedFetch } from '../../scripts/lib/iiif-utils.mjs';

/**
 * Guards rateLimitedFetch's retry policy against a real local server (#5084).
 *
 * The 4xx "bail without retrying" branch used to `throw` inside the same `try`
 * whose `catch` treats every error as transient, so a 404 was requested four
 * times with 500/1000/2000 ms of backoff. These tests count the requests the
 * server actually received. Negative control performed when written: restoring
 * the in-`try` throw makes the 404 and 403 tests fail with 4 requests.
 */
describe('rateLimitedFetch retry policy', () => {
  let server: http.Server;
  let base: string;
  const hits = new Map<string, number>();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url || '/';
      hits.set(path, (hits.get(path) || 0) + 1);
      const n = hits.get(path)!;
      if (path === '/404') { res.statusCode = 404; return res.end('nope'); }
      if (path === '/403') { res.statusCode = 403; return res.end('forbidden'); }
      // 503 on the first request, then 200: a transient failure that recovers.
      if (path === '/flaky') {
        if (n === 1) { res.statusCode = 503; return res.end('busy'); }
        return res.end('ok');
      }
      res.end('ok');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
  });

  it('a 404 is requested once and throws HTTP 404', async () => {
    const t0 = Date.now();
    await expect(rateLimitedFetch(`${base}/404`)).rejects.toThrow('HTTP 404');
    expect(hits.get('/404')).toBe(1);
    expect(Date.now() - t0).toBeLessThan(400); // no 500 ms backoff taken
  });

  it('a 403 is requested once — a refusal is not a reason to ask again', async () => {
    await expect(rateLimitedFetch(`${base}/403`)).rejects.toThrow('HTTP 403');
    expect(hits.get('/403')).toBe(1);
  });

  it('a 5xx is still retried and can recover', async () => {
    const buf = await rateLimitedFetch(`${base}/flaky`);
    expect(buf.toString()).toBe('ok');
    expect(hits.get('/flaky')).toBe(2);
  });
});
