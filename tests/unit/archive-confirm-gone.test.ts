/**
 * The confirmation step the archiving watchdog runs before parking a book as
 * "likely gone" (#4611).
 *
 * The stakes are asymmetric, and the tests are written around that:
 *  - A false `gone` parks a book we own at `needs_attention`, which every
 *    orchestrator phase skips — it stops being served, with no path back. #5462
 *    measured 709 of 721 such verdicts as false.
 *  - A false `unconfirmed` costs one more probe next run.
 * So `gone` must need a definite 403/404/410 on EVERY sample, and anything short
 * of that must decline. Per tests-that-are-not-guards.md the negative control is
 * here too: a genuinely dead URL must still be confirmed gone — a confirmation
 * that always declines is as useless as one that always confirms.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error — plain .mjs helper, no types
import { confirmGone, confirmUrl, pickSpread, createHostQueue, iaItemState } from '../../scripts/lib/archive-confirm-gone.mjs';

const noSleep = async () => {};
const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

/** Scripted fetch: per URL, a queue of responses (number = status, 'timeout', or a JSON body). */
function fakeFetch(script: Record<string, Array<number | 'timeout' | { json: unknown }>>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const q = script[url];
    if (!q) throw new Error(`unscripted ${url}`);
    const next = q.length > 1 ? q.shift()! : q[0];
    if (next === 'timeout') throw timeoutErr();
    if (typeof next === 'number') return new Response(null, { status: next });
    return new Response(JSON.stringify(next.json), { status: 200 });
  };
  return { impl, calls };
}

const opts = (fetchImpl: unknown) => ({ fetchImpl, sleep: noSleep, hostGapMs: 0 });
const A = 'https://host-a.example/p1.jpg', B = 'https://host-a.example/p2.jpg', C = 'https://host-a.example/p3.jpg';

describe('pickSpread', () => {
  it('takes first / middle / last, not the first three', () => {
    expect(pickSpread(['1', '2', '3', '4', '5', '6', '7'])).toEqual(['1', '4', '7']);
  });
  it('returns what there is when the book has fewer pages', () => {
    expect(pickSpread(['1', '2'])).toEqual(['1', '2']);
    expect(pickSpread([])).toEqual([]);
  });
  it('drops duplicates and blanks — two pages on one URL are one sample', () => {
    expect(pickSpread([A, A, null, A])).toEqual([A]);
  });
});

describe('confirmGone', () => {
  it('NEGATIVE CONTROL: every sample a definite 404 → gone (a dead source still parks)', async () => {
    const f = fakeFetch({ [A]: [404], [B]: [410], [C]: [403] });
    const r = await confirmGone({ urls: [A, B, C] }, opts(f.impl));
    expect(r.verdict).toBe('gone');
    expect(r.evidence.probes.map((p: { status: number }) => p.status)).toEqual([404, 410, 403]);
    // A definite answer is not retried.
    expect(f.calls).toHaveLength(3);
  });

  it('slow-but-live: a timeout followed by 200 → alive, not gone', async () => {
    const f = fakeFetch({ [A]: ['timeout', 200] });
    const r = await confirmGone({ urls: [A, B, C] }, opts(f.impl));
    expect(r.verdict).toBe('alive');
    expect(r.evidence.probes[0].attempts).toEqual(['timeout', 200]);
  });

  it('the Rumphius v.5 shape — timeouts on every attempt → unconfirmed, never gone', async () => {
    const f = fakeFetch({ [A]: ['timeout'], [B]: ['timeout'], [C]: ['timeout'] });
    const r = await confirmGone({ urls: [A, B, C] }, opts(f.impl));
    expect(r.verdict).toBe('unconfirmed');
    // Every sample retried the full number of attempts before giving up.
    expect(f.calls).toHaveLength(9);
  });

  it('one stale page URL is not a dead item: 404 + live page → alive', async () => {
    const f = fakeFetch({ [A]: [404], [B]: [200], [C]: [404] });
    const r = await confirmGone({ urls: [A, B, C] }, opts(f.impl));
    expect(r.verdict).toBe('alive');
  });

  it('404 mixed with a timeout → unconfirmed (all samples must be definite)', async () => {
    const f = fakeFetch({ [A]: [404], [B]: ['timeout'], [C]: [404] });
    expect((await confirmGone({ urls: [A, B, C] }, opts(f.impl))).verdict).toBe('unconfirmed');
  });

  it.each([429, 500, 503, 400, 401])('HTTP %i on every sample is not a verdict about the source', async (status) => {
    const f = fakeFetch({ [A]: [status], [B]: [status], [C]: [status] });
    expect((await confirmGone({ urls: [A, B, C] }, opts(f.impl))).verdict).toBe('unconfirmed');
  });

  it('a 2xx HTML soft-404 is not a live page → unconfirmed', async () => {
    const impl = async () => new Response('<html>not found</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const r = await confirmGone({ urls: [A, B, C] }, opts(impl));
    expect(r.verdict).toBe('unconfirmed');
    expect(r.evidence.probes[0].attempts).toEqual(['200 text/html', '200 text/html', '200 text/html']);
  });

  it('no URL to probe → unconfirmed, not gone', async () => {
    const f = fakeFetch({});
    expect((await confirmGone({ urls: [] }, opts(f.impl))).verdict).toBe('unconfirmed');
  });

  describe('Internet Archive item metadata', () => {
    const IA = 'https://archive.org/metadata/someitem';
    const dead = { [A]: [404], [B]: [404], [C]: [404] } as const;

    it('pages 404 but the item is present → unconfirmed (stale page URLs)', async () => {
      const f = fakeFetch({ ...dead, [IA]: [{ json: { metadata: { identifier: 'someitem' }, workable_servers: ['ia1'] } }] } as never);
      const r = await confirmGone({ urls: [A, B, C], iaIdentifier: 'someitem' }, opts(f.impl));
      expect(r.verdict).toBe('unconfirmed');
      expect(r.evidence.ia.state).toBe('present');
    });

    it('pages 404 and the item does not exist → gone', async () => {
      const f = fakeFetch({ ...dead, [IA]: [{ json: {} }] } as never);
      const r = await confirmGone({ urls: [A, B, C], iaIdentifier: 'someitem' }, opts(f.impl));
      expect(r.verdict).toBe('gone');
      expect(r.evidence.ia.state).toBe('absent');
    });

    it('pages 404 and the item is dark → gone', async () => {
      const f = fakeFetch({ ...dead, [IA]: [{ json: { is_dark: true } }] } as never);
      expect((await confirmGone({ urls: [A, B, C], iaIdentifier: 'someitem' }, opts(f.impl))).verdict).toBe('gone');
    });

    it('pages 404 but the metadata call failed → unconfirmed (no information is not absence)', async () => {
      const f = fakeFetch({ ...dead, [IA]: ['timeout'] } as never);
      const r = await confirmGone({ urls: [A, B, C], iaIdentifier: 'someitem' }, opts(f.impl));
      expect(r.verdict).toBe('unconfirmed');
      expect(r.evidence.ia.state).toBe('unknown');
    });

    it('ignores the manifest.json pseudo-identifier', async () => {
      expect(await iaItemState('manifest.json', opts(fakeFetch({}).impl))).toBeNull();
    });
  });

  it('records the evidence the watchdog writes to pipeline_auto.archive_confirm', async () => {
    const f = fakeFetch({ [A]: [404] });
    const r = await confirmGone({ urls: [A] }, opts(f.impl));
    expect(r.evidence).toMatchObject({ verdict: 'gone', attempts: 3, probes: [{ url: A, status: 404, attempts: [404] }] });
    expect(r.evidence.checked_at).toBeInstanceOf(Date);
    expect(r.evidence.reason).toContain('1/1');
  });
});

describe('createHostQueue', () => {
  it('runs at most one request per host at a time, hosts in parallel', async () => {
    const withHost = createHostQueue({ gapMs: 0 });
    const inflight: Record<string, number> = {}, peak: Record<string, number> = {};
    const job = (host: string) => withHost(host, async () => {
      inflight[host] = (inflight[host] || 0) + 1;
      peak[host] = Math.max(peak[host] || 0, inflight[host]);
      await new Promise((r) => setTimeout(r, 5));
      inflight[host]--;
    });
    await Promise.all([job('a'), job('a'), job('a'), job('b'), job('b')]);
    expect(peak).toEqual({ a: 1, b: 1 });
  });

  it('keeps going after a request throws', async () => {
    const withHost = createHostQueue({ gapMs: 0 });
    await expect(withHost('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withHost('a', async () => 'ok')).resolves.toBe('ok');
  });
});

// The same rules over a real socket and the real fetch / AbortSignal.timeout path.
describe('confirmUrl against a live HTTP server', () => {
  let server: http.Server, base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/dead') { res.statusCode = 404; res.end(); return; }
      if (req.url === '/slow') { setTimeout(() => { res.statusCode = 200; res.end('ok'); }, 150); return; }
      // /hang never answers inside the timeout
      setTimeout(() => { res.statusCode = 200; res.end(); }, 2000);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.closeAllConnections?.(); server.close(); });

  const live = { sleep: noSleep, hostGapMs: 0, timeoutMs: 600, attempts: 2 };

  it('a dead URL is confirmed dead', async () => {
    expect((await confirmUrl(`${base}/dead`, live)).final.status).toBe(404);
    expect((await confirmGone({ urls: [`${base}/dead`] }, live)).verdict).toBe('gone');
  });

  it('a slow-but-live URL inside the confirmation timeout is alive', async () => {
    expect((await confirmGone({ urls: [`${base}/slow`] }, live)).verdict).toBe('alive');
  });

  it('a URL that never answers in time is unconfirmed, after retrying', async () => {
    const r = await confirmUrl(`${base}/hang`, { ...live, timeoutMs: 100 });
    expect(r.attempts).toEqual(['timeout', 'timeout']);
    expect((await confirmGone({ urls: [`${base}/hang`] }, { ...live, timeoutMs: 100 })).verdict).toBe('unconfirmed');
  });
});
