/**
 * `fetchWithStallTimeout` — a stall timeout, not a total-duration cap.
 *
 * The bug this replaces: archivers aborted 60s after a fetch STARTED, which is
 * a size limit wearing a clock's clothing. Measured on Thibault's *Académie de
 * l'Espée* (Gallica), the 21.7 MB double-page plates took ~38s alone and blew
 * the cap under any concurrency — 42 of 45 engravings failed while every 6 MB
 * text page succeeded.
 *
 * Each test drives a real HTTP server rather than asserting on source shape,
 * and the first test includes a NEGATIVE CONTROL: the same slow-but-healthy
 * response is shown to fail under the old total-duration cap. Without that,
 * the test proves nothing about whether the fix was needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error — plain .mjs helper, no types
import { fetchWithStallTimeout } from '../../scripts/lib/fetch-stall-timeout.mjs';

let server: http.Server | null = null;

function listen(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** The old implementation: abort N ms after the fetch begins, regardless of progress. */
async function fetchWithTotalCap(url: string, capMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), capMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

describe('fetchWithStallTimeout', () => {
  it('completes a slow but steadily-progressing body that a total-duration cap would abort', async () => {
    // 10 chunks, 60ms apart => ~600ms total, but never more than 60ms of silence.
    // This is a large plate on a slow link, in miniature.
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      let n = 0;
      const tick = setInterval(() => {
        if (n++ >= 10) {
          clearInterval(tick);
          res.end();
          return;
        }
        res.write(Buffer.alloc(1024, 1));
      }, 60);
    });

    const { res, buffer } = await fetchWithStallTimeout(url, { stallMs: 300 });
    expect(res.ok).toBe(true);
    expect(buffer.length).toBe(10 * 1024);

    // NEGATIVE CONTROL: the same healthy response under the old 300ms total cap.
    // If this did NOT throw, the stall timeout would be solving nothing.
    await expect(fetchWithTotalCap(url, 300)).rejects.toThrow();
  });

  it('aborts a connection that goes silent, and says why', async () => {
    // Headers, one chunk, then nothing — a dead socket, which we must still catch.
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.write(Buffer.alloc(64, 1));
      // deliberately never end
    });

    await expect(fetchWithStallTimeout(url, { stallMs: 150 })).rejects.toThrow(/stalled/);
  });

  it('names the reason rather than surfacing a bare "operation was aborted"', async () => {
    // The opaque abort message is what made this read as rate-limiting for two
    // debugging passes, so the reason text is part of the contract.
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.write(Buffer.alloc(8, 1));
    });

    await expect(fetchWithStallTimeout(url, { stallMs: 100 })).rejects.toThrow(/no data for/);
  });

  it('returns a non-ok response to the caller instead of throwing, so 429 handling still works', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('slow down');
    });

    const { res } = await fetchWithStallTimeout(url, { stallMs: 500 });
    expect(res.status).toBe(429);
  });

  it('prefixes abort errors with "fetch aborted" — archivers match on this to retry', async () => {
    // archive-ocr.mjs previously retried on `err.name === 'AbortError'`. Routing
    // through this helper replaces that with a thrown Error, so the message
    // prefix IS the contract now: if it changes, that worker silently loses a
    // retry path it used to have and stalls become hard failures.
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.write(Buffer.alloc(8, 1));
    });

    await expect(fetchWithStallTimeout(url, { stallMs: 100 })).rejects.toThrow(/^fetch aborted:/);
  });

  it('enforces the absolute backstop against a connection that trickles forever', async () => {
    // Chunks forever, each inside the stall window — healthy by the stall test,
    // but it must not run unbounded.
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      const tick = setInterval(() => res.write(Buffer.alloc(8, 1)), 20);
      res.on('close', () => clearInterval(tick));
    });

    await expect(
      fetchWithStallTimeout(url, { stallMs: 5_000, maxMs: 300 })
    ).rejects.toThrow(/absolute cap/);
  });
});
