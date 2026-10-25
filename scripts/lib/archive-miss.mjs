/**
 * Permanent misses and rotation for the archive lanes (#5448).
 *
 * PRIOR ART: scripts/lib/host-breaker.mjs (per-HOST, in-memory, never durable —
 *   right for "this host is refusing us", wrong for "this one URL is gone": a
 *   404 is a fact about a page, and fed to the host breaker it paused a healthy
 *   host); scripts/lib/archive-coverage.mjs (classifies what is archived, not
 *   what can never be); classifyArchiveFailure() in the archivers (writes
 *   `failed:` into archived_photo, which archive-fetch-failures.md forbids for
 *   anything we cannot attribute — a 404 we CAN attribute, but it still must not
 *   hide the page from a repaired URL, so it lives beside the field, keyed to the
 *   URL that missed).
 *
 * What went wrong (2026-10-16 → 10-25, lane-heidelberg): 108,133 runs, every
 * one "partial 40 | pages 0 ok, 6 failed [404], 34373 skipped". The first book
 * in line (Bodleian MS. Laud Misc. 348 through a broken Heidelberg
 * iiif-proxy.cgi URL) answered 404 to every page; five 404s tripped the HOST
 * breaker's cold-start rule, which then skipped every page of the 39 healthy
 * books behind it. Nothing stamped the book on a failed attempt, so the next run
 * drew the identical 40 in the identical order, eight seconds later, for nine
 * days. Three separate faults, one per export below:
 *
 *   1. A 404/410 is a page verdict, not a host verdict → `createBookMissGuard`
 *      abandons the BOOK for this run, and only a run of such books with no
 *      success at all reaches the host breaker.
 *   2. A page that misses the same URL MISS_LIMIT times is a permanent miss →
 *      `missUpdate` / `isPermanentMiss`, recorded under `archive_metadata.miss`.
 *      Keyed to the URL: repair the URL and the page is eligible again with no
 *      cleanup step anyone has to remember.
 *   3. A book whose only missing pages are permanent misses is done-with-gaps,
 *      not partial → `bookVerdict`, bounded so a book that is MOSTLY 404s (a
 *      URL-scheme problem, like the Bodleian proxy) never qualifies.
 */

/** HTTP statuses that say "this URL does not exist", as opposed to "not now". */
export const MISS_CODES = Object.freeze(['404', '410']);

/** Misses on the same URL, across separate runs, before a page is given up on. */
export const MISS_LIMIT = 3;

/**
 * A book is done-with-gaps only if its permanent misses are a small minority.
 * Above this, the misses are a fact about how we address the book, not about
 * a few lost leaves — keep it partial and visible to a human.
 */
export const GAP_MAX_FRACTION = 0.05;

/** Same bar the archiver has always used for "complete". */
export const COMPLETE_FRACTION = 0.99;

export const isMissCode = (code) => MISS_CODES.includes(String(code));

/**
 * Has this page missed `url` often enough to stop asking for it?
 * @param {{archive_metadata?: {miss?: {url?: string, count?: number}}}} page
 * @param {string} url the URL the archiver would request NOW (after upgradeToFullRes)
 */
export function isPermanentMiss(page, url, limit = MISS_LIMIT) {
  const m = page?.archive_metadata?.miss;
  return !!m && m.url === url && (m.count ?? 0) >= limit;
}

/**
 * The `$set` recording one more miss of `url` on `page`. A miss on a DIFFERENT
 * url restarts the count: the old verdict was about an address we no longer use.
 */
export function missUpdate(page, url, code, now = new Date()) {
  const m = page?.archive_metadata?.miss;
  const count = m && m.url === url ? (m.count ?? 0) + 1 : 1;
  return {
    'archive_metadata.miss': { url, status: String(code), count, last_at: now },
  };
}

/**
 * @param {{pagesCount: number, archived: number, misses: number}} c
 * @returns {'complete' | 'complete_with_gaps' | 'partial'}
 */
export function bookVerdict({ pagesCount, archived, misses }) {
  const pc = pagesCount || 0;
  if (archived > 0 && archived >= pc * COMPLETE_FRACTION) return 'complete';
  if (archived > 0 && misses > 0 && misses <= Math.max(1, Math.floor(pc * GAP_MAX_FRACTION))
      && archived + misses >= pc * COMPLETE_FRACTION) return 'complete_with_gaps';
  return 'partial';
}

/**
 * Per-run, per-book: stop spending requests on a book whose pages keep missing
 * before any of them has been served. A book that has served pages keeps going
 * (a scattered missing leaf costs one request), so a gap mid-book is recorded,
 * not used as an excuse to quit.
 */
export function createBookMissGuard({ streak = 5 } = {}) {
  const books = new Map();
  const s = (id) => { let v = books.get(id); if (!v) books.set(id, v = { ok: 0, miss: 0, run: 0 }); return v; };
  return {
    ok(id) { const v = s(id); v.ok++; v.run = 0; },
    miss(id) { const v = s(id); v.miss++; v.run++; },
    /** Other failures (timeouts, 5xx) break nothing here — the host breaker owns them. */
    abandoned(id) { const v = books.get(id); return !!v && v.ok === 0 && v.run >= streak; },
    stateOf(id) { return books.get(id); },
  };
}

/**
 * Book-mode sort. Least-recently-ATTEMPTED first: a book that could not be
 * finished goes to the back of the line. `updated_at` was meant to do this but
 * was only stamped on completion, so a failing head stayed the head forever.
 */
export const ROTATION_SORT = Object.freeze({ 'archive_metadata.last_attempt_at': 1, updated_at: 1 });
