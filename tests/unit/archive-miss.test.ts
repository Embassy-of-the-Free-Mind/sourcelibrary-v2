/**
 * The archive lanes must not spin on books they cannot advance (#5448).
 *
 * lane-heidelberg ran 108,133 times in nine days, each run "0 ok, 6 failed
 * [404], 34373 skipped". Three faults made that loop, and each has a test here:
 *   1. a 404 tripped the HOST breaker, so one book of dead URLs paused a host
 *      that serves the other books fine;
 *   2. a page that 404s forever was asked for forever, and its book could never
 *      leave the "partial" set;
 *   3. the lane only slept when the batch was EMPTY, never when a run archived
 *      nothing.
 * Negative controls run when written: feeding `pageMiss` through `failure`
 * turns "a book of dead URLs does not pause the host" red; dropping the
 * `m.url === url` check turns "a repaired URL is eligible again" red; removing
 * the `pages 0 ok` branch from archive-lane.sh turns the idle-sleep test red.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { createHostBreaker, BREAKER_DEFAULTS } from '../../scripts/lib/host-breaker.mjs';
import {
  isMissFor, isBookScopedFailure, FAIL_STREAK,
  isPermanentMiss, missUpdate, bookVerdict, createBookMissGuard, isMissCode, MISS_LIMIT, ROTATION_SORT,
  // @ts-expect-error — plain .mjs helper, no types
} from '../../scripts/lib/archive-miss.mjs';

const H = 'digi.ub.uni-heidelberg.de';
const URL_A = `https://${H}/iiif/2/x%3A001.jpg/full/full/0/default.jpg`;
const URL_B = `https://${H}/iiif/2/x%3A001r.jpg/full/full/0/default.jpg`;

describe('a 404 is a fact about a page, not a host', () => {
  it('a book of dead URLs does not pause the host', () => {
    const b = createHostBreaker({ now: () => 1_000_000 });
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails * 4; i++) b.pageMiss(H, '404');
    expect(b.isOpen(H), 'twenty 404s from one book paused the host — the #5448 loop').toBe(false);
    expect(b.allow(H)).toBe(true);
    expect(b.report()).toMatch(/page-miss 20 \[404:20\]/);
  });

  it('negative control: the same count of real failures still trips it', () => {
    const b = createHostBreaker({ now: () => 1_000_000 });
    for (let i = 0; i < BREAKER_DEFAULTS.coldStartFails; i++) b.failure(H, 'timeout');
    expect(b.isOpen(H)).toBe(true);
  });

  it('only 404 and 410 are misses — 400, 403, 429 keep their own handling', () => {
    expect(isMissCode('404')).toBe(true);
    expect(isMissCode('410')).toBe(true);
    for (const c of ['400', '401', '403', '429', '500', 'timeout', 'network']) expect(isMissCode(c), c).toBe(false);
  });
});

describe('per-book guard: give up on a book for this run, not on the host', () => {
  it('abandons a book whose pages keep missing before any is served', () => {
    const g = createBookMissGuard({ streak: 5 });
    for (let i = 0; i < 4; i++) g.miss('dead');
    expect(g.abandoned('dead')).toBe(false);
    g.miss('dead');
    expect(g.abandoned('dead')).toBe(true);
    expect(g.abandoned('other'), 'one book\'s misses are not another\'s').toBe(false);
  });

  it('keeps going on a book that has served pages: a missing leaf costs one request, not the book', () => {
    const g = createBookMissGuard({ streak: 5 });
    g.ok('b');
    for (let i = 0; i < 20; i++) g.miss('b');
    expect(g.abandoned('b')).toBe(false);
  });
});

describe('permanent miss: recorded on the page, keyed to the URL', () => {
  /** Apply a $set of dotted archive_metadata keys to a page, as Mongo would. */
  const apply = (page: any, set: Record<string, unknown>) => {
    const am = { ...(page.archive_metadata ?? {}) };
    for (const [k, v] of Object.entries(set)) am[k.replace('archive_metadata.', '')] = v;
    return { ...page, archive_metadata: am };
  };

  it('counts consecutive misses of the same URL up to the limit', () => {
    let page: any = {};
    for (let i = 1; i <= MISS_LIMIT; i++) {
      expect(isPermanentMiss(page, URL_A), `after ${i - 1} misses`).toBe(false);
      const set = missUpdate(page, URL_A, '404', new Date(0));
      expect(set['archive_metadata.failure_count']).toBe(i);
      page = apply(page, set);
    }
    expect(isPermanentMiss(page, URL_A)).toBe(true);
  });

  it('a repaired URL is eligible again, with no cleanup step', () => {
    const page = { archive_metadata: { failure_count: MISS_LIMIT, last_failure_reason: 'HTTP 404', last_failure_source_url: URL_A } };
    expect(isPermanentMiss(page, URL_A)).toBe(true);
    expect(isPermanentMiss(page, URL_B)).toBe(false);
    expect(missUpdate(page, URL_B, '404')['archive_metadata.failure_count'], 'a new URL starts its own count').toBe(1);
  });

  it('archive-ocr timeouts on the same fields are not evidence a URL is gone', () => {
    // archive-ocr.mjs counts every failure in failure_count. Three timeouts must
    // not let a single 404 finish the page off.
    const page = { archive_metadata: { failure_count: 3, last_failure_reason: 'fetch aborted: stalled', last_failure_source_url: URL_A } };
    expect(isPermanentMiss(page, URL_A)).toBe(false);
    expect(missUpdate(page, URL_A, '404')['archive_metadata.failure_count']).toBe(1);
  });

  it('writes only the existing archive_metadata failure fields — never archived_photo, the work queue', () => {
    expect(Object.keys(missUpdate({}, URL_A, '410')).sort()).toEqual([
      'archive_metadata.failure_count', 'archive_metadata.last_failure_at',
      'archive_metadata.last_failure_reason', 'archive_metadata.last_failure_source_url',
    ]);
  });
});

describe('book verdict', () => {
  it('complete at the 99% bar, as before', () => {
    expect(bookVerdict({ pagesCount: 100, archived: 99, misses: 0 })).toBe('complete');
    expect(bookVerdict({ pagesCount: 100, archived: 98, misses: 0 })).toBe('partial');
  });

  it('done-with-gaps when every page the source still has is archived', () => {
    expect(bookVerdict({ pagesCount: 800, archived: 780, misses: 20 })).toBe('complete_with_gaps');
  });

  it('a book that is MOSTLY misses stays partial — that is a URL problem, not lost leaves', () => {
    // The Bodleian-through-Heidelberg proxy book: every page 404s.
    expect(bookVerdict({ pagesCount: 790, archived: 0, misses: 790 })).toBe('partial');
    expect(bookVerdict({ pagesCount: 100, archived: 80, misses: 20 })).toBe('partial');
  });

  it('missing pages that are NOT permanent misses still leave it partial', () => {
    expect(bookVerdict({ pagesCount: 800, archived: 700, misses: 6 })).toBe('partial');
  });
});

describe('rotation', () => {
  it('book mode orders by last attempt first, so a failed head goes to the back', () => {
    expect(Object.keys(ROTATION_SORT)[0]).toBe('archive_metadata.last_attempt_at');
  });
});

describe('archive-lane.sh sleeps after a run that archived nothing', () => {
  /**
   * Runs the real wrapper in a scratch tree with `npx` and `sleep` stubbed:
   * npx prints a canned archiver summary, sleep records that it was called and
   * stops the loop. Returns the run index at which the lane first slept.
   */
  function firstSleepAfter(summaries: string[]): number | null {
    const root = mkdtempSync(path.join(tmpdir(), 'lane-'));
    mkdirSync(path.join(root, 'scripts/catalog-coverage'), { recursive: true });
    const lane = path.join(root, 'scripts/catalog-coverage/archive-lane.sh');
    copyFileSync(path.resolve(__dirname, '../../scripts/catalog-coverage/archive-lane.sh'), lane);
    writeFileSync(path.join(root, '.env.production.local'), '');
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    summaries.forEach((s, i) => writeFileSync(path.join(root, `run${i}`), s));
    // npx: print the next canned run; past the end, stop the lane outright.
    writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env bash
n=$(cat "${root}/count" 2>/dev/null || echo 0); echo $((n+1)) > "${root}/count"
[ -f "${root}/run$n" ] || { kill -TERM $(cat "${root}/lanepid"); exit 0; }
cat "${root}/run$n"
`);
    writeFileSync(path.join(bin, 'sleep'), `#!/usr/bin/env bash
cat "${root}/count" > "${root}/slept"; kill -TERM $(cat "${root}/lanepid")
`);
    chmodSync(path.join(bin, 'npx'), 0o755);
    chmodSync(path.join(bin, 'sleep'), 0o755);
    try {
      execFileSync('bash', ['-c', `echo $$ > "${root}/lanepid"; exec "${lane}"`], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LANE: `t${process.pid}${Date.now()}`, ARCHIVE_ARGS: '--hosts example.org', ARCHIVE_IDLE_SLEEP: '1' },
        stdio: 'ignore', timeout: 20_000,
      });
    } catch { /* the stub ends the loop with SIGTERM */ }
    return existsSync(path.join(root, 'slept')) ? Number(readFileSync(path.join(root, 'slept'), 'utf8')) : null;
  }

  const busy = '00:00:01 archive-acquired (finished): complete 1, with gaps 0, partial 0, stalled 0 | books 1/1 | pages 12 ok, 0 failed, 0 missed [404/410], 0 skipped in 0.1m (2.00 pages/s)\n';
  const spun = '00:00:01 archive-acquired (finished): complete 0, with gaps 0, partial 40, stalled 0 | books 40/40 | pages 0 ok, 6 failed, 0 missed [404/410], 34373 skipped in 0.1m (0.00 pages/s)\n';
  const killed = '00:50:00 archive-acquired (stopped by SIGTERM): complete 0, with gaps 0, partial 0, stalled 0 | books 0/40 | pages 0 ok, 0 failed, 0 missed [404/410], 0 skipped in 50.0m (0.00 pages/s)\n';

  it('a run that archived 0 pages is followed by the idle sleep', () => {
    expect(firstSleepAfter([busy, busy, spun])).toBe(3);
  });

  it('busy runs and a run stopped at the ceiling do not sleep', () => {
    expect(firstSleepAfter([busy, killed, busy])).toBe(null);
  });

  // lane-gallica 2026-10-26: 40 books whose pages were already on R2, closed with 0 fetches. Progress.
  const closed = '00:24:12 archive-acquired (finished): complete 40, with gaps 0, partial 0, stalled 0 | books 40/40 | pages 0 ok, 0 failed, 0 missed [404/410], 0 skipped in 0.1m (0.00 pages/s)\n';
  const gapsOnly = '00:24:12 archive-acquired (finished): complete 0, with gaps 3, partial 0, stalled 0 | books 3/3 | pages 0 ok, 0 failed, 0 missed [404/410], 0 skipped in 0.1m (0.00 pages/s)\n';

  it('a run that fetched nothing but closed books is progress, not idle (#5448)', () => {
    expect(firstSleepAfter([closed, gapsOnly, busy])).toBe(null);
  });
});

describe('host-specific miss codes (#5448)', () => {
  const folio = 'https://openapi.bnf.fr/iiif/image/v3/ark:/12148/bpt6k15122214/f46/full/max/0/default.jpg';
  it("openapi.bnf.fr's 500 for a folio past the document's end is a miss; elsewhere a 500 is not", () => {
    expect(isMissFor(folio, '500')).toBe(true);
    expect(isMissFor('https://gallica.bnf.fr/iiif/ark:/12148/x/f1/full/full/0/default.jpg', '500')).toBe(false);
    expect(isMissFor('https://example.org/a.jpg', '404')).toBe(true);
    expect(isMissFor('not a url', '500')).toBe(false);
  });
  it('a host miss is recorded so it can become permanent after MISS_LIMIT runs, keyed to the URL', () => {
    let page: any = {};
    for (let i = 0; i < MISS_LIMIT; i++) {
      const set = missUpdate(page, folio, '500');
      page = { archive_metadata: { failure_count: set['archive_metadata.failure_count'], last_failure_reason: set['archive_metadata.last_failure_reason'], last_failure_source_url: set['archive_metadata.last_failure_source_url'] } };
    }
    expect(page.archive_metadata.last_failure_reason).toBe('HTTP 500 (no such page at openapi.bnf.fr)');
    expect(isPermanentMiss(page, folio)).toBe(true);
    expect(isPermanentMiss(page, folio.replace('f46', 'f47'))).toBe(false);
  });
  it('archive-acquired and the manifest archiver both ask isMissFor, not the bare code', () => {
    for (const f of ['scripts/catalog-coverage/archive-acquired.ts', 'scripts/lib/manifest-archive.mjs']) {
      const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      expect(src, f).toMatch(/!fetched && isMissFor\(url, code\)/);
    }
  });
});

describe('a 400/500 from a book that has served nothing is about the book (#5448)', () => {
  it('abandons the book after FAIL_STREAK, and only while it has served nothing', () => {
    const g = createBookMissGuard();
    for (let i = 0; i < FAIL_STREAK - 1; i++) g.fail('b');
    expect(g.abandoned('b')).toBe(false);
    g.fail('b');
    expect(g.abandoned('b')).toBe(true);
    const h = createBookMissGuard();
    h.ok('c'); h.fail('c'); h.fail('c'); h.fail('c');
    expect(h.fresh('c')).toBe(false);
    expect(h.abandoned('c')).toBe(false);
  });
  it('only 400 and 500 are book-scoped; refusals, throttles and timeouts stay host verdicts', () => {
    expect(isBookScopedFailure('500')).toBe(true);
    expect(isBookScopedFailure('400')).toBe(true);
    for (const c of ['401', '403', '429', '503', 'timeout', 'network']) expect(isBookScopedFailure(c)).toBe(false);
  });
  it('one broken book no longer trips the host breaker: the archivers charge the host once per abandoned book', () => {
    const b = createHostBreaker();
    const g = createBookMissGuard();
    // Göttingen PPN870120751_1702: every page 500.
    for (let i = 0; i < FAIL_STREAK; i++) { g.fail('broken'); b.pageMiss('images.sub.uni-goettingen.de', '500'); }
    if (g.abandoned('broken')) b.failure('images.sub.uni-goettingen.de', 'dead-book-500');
    expect(b.allow('images.sub.uni-goettingen.de')).toBe(true);
    for (const f of ['scripts/catalog-coverage/archive-acquired.ts', 'scripts/lib/manifest-archive.mjs']) {
      expect(readFileSync(path.resolve(__dirname, '../..', f), 'utf8'), f).toMatch(/isBookScopedFailure\(code\) && missGuard\.fresh\(bookId\)/);
    }
  });
});

describe('archive-acquired keeps a miss only from a host that has served this run (#5448)', () => {
  it('guards the missUpdate write with missesCount(host)', () => {
    const src = readFileSync(path.resolve(__dirname, '../../scripts/catalog-coverage/archive-acquired.ts'), 'utf8');
    expect(src).toMatch(/const missesCount = \(host: string\) => \(breaker\.stateOf\(host\)\?\.ok \?\? 0\) > 0;/);
    expect(src).toMatch(/if \(missesCount\(host\)\) \{\s*try \{ await pages\.updateOne\(\{ _id: p\._id \}, \{ \$set: missUpdate\(p, url, code\) \}\)/);
  });
});
