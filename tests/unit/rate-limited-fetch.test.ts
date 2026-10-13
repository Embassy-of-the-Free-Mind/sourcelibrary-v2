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
      // A large plate on a slow link, in miniature: ~600 ms total, never more
      // than 60 ms of silence.
      if (path === '/slow-plate') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        let i = 0;
        const tick = setInterval(() => {
          if (i++ >= 10) { clearInterval(tick); return res.end(); }
          res.write(Buffer.alloc(1024, 1));
        }, 60);
        return;
      }
      // Headers and one chunk, then silence: a dead connection.
      if (path === '/stalled') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.write(Buffer.alloc(1024, 1));
        return; // never ends
      }
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
    server.closeAllConnections();
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

  /**
   * `timeout` is a stall timeout with an absolute backstop (#4402), the same
   * discipline as fetch-stall-timeout.mjs in the other archivers.
   *
   * Negative control performed when written, against the previous
   * implementation (AbortController armed per attempt, cleared once headers
   * arrived): the slow-plate test PASSED — that cap only ever covered time to
   * headers — but the stalled body hung until vitest killed it at 30s, and the
   * trickle was never cut off. The old timer bounded the cheap half of the
   * request and left the body, where a master spends its time, unbounded.
   */
  describe('rateLimitedFetch timeout semantics', () => {
    it('completes a body that takes 4x `timeout` while it keeps delivering', async () => {
      const buf = await rateLimitedFetch(`${base}/slow-plate`, { timeout: 150, retries: 0 });
      expect(buf.length).toBe(10 * 1024);
    });

    it('still fails fast on a connection that stops delivering, and says why', async () => {
      const t0 = Date.now();
      await expect(rateLimitedFetch(`${base}/stalled`, { timeout: 150, retries: 0 }))
        .rejects.toThrow(/stalled — no data/);
      expect(Date.now() - t0).toBeLessThan(1000);
    });

    it('keeps an absolute backstop for a connection that trickles forever', async () => {
      await expect(rateLimitedFetch(`${base}/slow-plate`, { timeout: 150, maxMs: 200, retries: 0 }))
        .rejects.toThrow(/absolute cap/);
    });
  });
});
