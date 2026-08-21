/**
 * Guards for the two defects found auditing `reading_history` on 2026-07-29.
 *
 * 1. RETURN IS DAY-BASED. "Members who came back" used to count `sessions > 1`.
 *    A session is one user+BOOK, so a member who opened three books in one
 *    sitting scored as a returning reader. Over a 30-day window that read 62.2%
 *    while only 30.8% of members read on more than one calendar day. The test
 *    below constructs exactly that member — several books, one afternoon — and
 *    fails if they are ever counted as a return again.
 *
 * 2. REFERRER IS BOUNDED AND SCHEME-CHECKED. The field is now actually written,
 *    from a `sendBeacon` body a client controls, and is returned by
 *    `GET /api/reading-history`.
 *
 * These exercise the real functions against real shapes rather than asserting
 * that a line of source exists — a source-grep guard here would have passed
 * throughout the period the metric was wrong, because the wrong line was the
 * one it would have pinned.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeReferrer } from '../../src/lib/reading-history-referrer';
import { computeMemberReadingDepth } from '../../scripts/lib/reading-depth.mjs';

/** Minimal stand-in for the one aggregate() call the function makes. */
function fakeDb(rows: Record<string, unknown>[]) {
  return {
    collection: () => ({
      aggregate: (pipeline: Record<string, never>[]) => ({
        toArray: async () => {
          const since = (pipeline[0] as unknown as { $match: { updated_at: { $gte: Date } } })
            .$match.updated_at.$gte;
          return rows
            .filter((r) => new Date(r.updated_at as string) >= since)
            .map((r) => ({
              user_id: r.user_id,
              book_id: r.book_id,
              started_at: r.started_at,
              updated_at: r.updated_at,
              viewed: r.pages_viewed ?? 0,
              distinct: ((r.pages_read as unknown[]) ?? []).length,
            }));
        },
      }),
    }),
  };
}

const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ page_id: `p${i}`, page_number: i + 1 }));

const session = (
  user: string,
  book: string,
  n: number,
  startISO: string,
  minutes = 10
) => ({
  user_id: user,
  book_id: book,
  pages_read: pages(n),
  pages_viewed: n,
  started_at: startISO,
  updated_at: new Date(new Date(startISO).getTime() + minutes * 60_000).toISOString(),
});

describe('computeMemberReadingDepth — return behaviour', () => {
  const since = new Date('2026-07-01T00:00:00Z');

  it('does not count several books in one sitting as a returning member', async () => {
    // One member, one afternoon, three books. Three sessions, zero returns.
    const db = fakeDb([
      session('binger', 'a', 12, '2026-07-10T13:00:00Z'),
      session('binger', 'b', 8, '2026-07-10T13:30:00Z'),
      session('binger', 'c', 20, '2026-07-10T14:00:00Z'),
    ]);
    const m = await computeMemberReadingDepth(db, since);

    expect(m.users).toBe(1);
    expect(m.sessions).toBe(3);
    expect(m.multiSessionUsers).toBe(1); // what the old metric counted
    expect(m.multiDayUsers).toBe(0); // what a return actually is
    expect(m.spanOver24hUsers).toBe(0);
    expect(m.singleHourUsers).toBe(0); // spans 13:00–14:10, so not one-and-done
    expect(m.multiBookUsers).toBe(1);
  });

  it('counts a member who reads on a second day', async () => {
    const db = fakeDb([
      session('returner', 'a', 5, '2026-07-10T13:00:00Z'),
      session('returner', 'a', 5, '2026-07-14T09:00:00Z'),
    ]);
    const m = await computeMemberReadingDepth(db, since);

    expect(m.multiDayUsers).toBe(1);
    expect(m.spanOver24hUsers).toBe(1);
    expect(m.multiBookUsers).toBe(0); // same book twice is a return, not breadth
  });

  it('reports page mass separately from session counts', async () => {
    // Nine drive-by single pages and one long sitting: the shallow tail is 90%
    // of sessions and 10% of the reading. Quoting sessions alone inverts it.
    const rows = [
      ...Array.from({ length: 9 }, (_, i) =>
        session(`drive${i}`, 'a', 1, '2026-07-10T13:00:00Z', 0)
      ),
      session('reader', 'b', 90, '2026-07-10T13:00:00Z', 60),
    ];
    const m = await computeMemberReadingDepth(fakeDb(rows), since);

    expect(m.oneOnly).toBe(9);
    expect(m.sessions).toBe(10);
    expect(m.totalPages).toBe(99);
    expect(m.pagesOneOnly).toBe(9);
    expect(m.pagesDeep).toBe(90);
  });

  it('flags machine-pace sessions instead of silently dropping them', async () => {
    const db = fakeDb([
      session('human', 'a', 30, '2026-07-10T13:00:00Z', 30), // 1 page/min
      session('bulk', 'b', 600, '2026-07-10T13:00:00Z', 2), // 300 pages/min
    ]);
    const m = await computeMemberReadingDepth(db, since);

    expect(m.pacedSessions).toBe(2);
    expect(m.fastSessions).toBe(1);
    expect(m.fastPages).toBe(600);
    // Both sessions still count as deep reads — the exclusion is reported, not
    // applied, because per-session shares are robust to these accounts.
    expect(m.deep).toBe(2);
    expect(m.top1PctPageShare).toBeGreaterThan(0.9);
  });

  it('returns null rather than a zeroed shape when the window is empty', async () => {
    expect(await computeMemberReadingDepth(fakeDb([]), since)).toBeNull();
  });
});

describe('sanitizeReferrer', () => {
  it('keeps http(s) origins and drops query strings', () => {
    expect(sanitizeReferrer('https://sourcelibrary.org/collections/alchemy')).toBe(
      'https://sourcelibrary.org/collections/alchemy'
    );
    // The path is the answer to "which surface did they come from", so it stays.
    // The query string is search terms and tracking params — third-party PII we
    // have no use for — so it goes.
    expect(sanitizeReferrer('https://www.google.com/search?q=key+of+solomon')).toBe(
      'https://www.google.com/search'
    );
    expect(sanitizeReferrer('https://sourcelibrary.org/search?q=agrippa#hit-3')).toBe(
      'https://sourcelibrary.org/search'
    );
  });

  it('refuses non-http schemes', () => {
    expect(sanitizeReferrer('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeReferrer('data:text/html,<script>')).toBeUndefined();
    expect(sanitizeReferrer('file:///etc/passwd')).toBeUndefined();
  });

  it('refuses junk, non-strings and oversized values', () => {
    expect(sanitizeReferrer('')).toBeUndefined();
    expect(sanitizeReferrer('   ')).toBeUndefined();
    expect(sanitizeReferrer('not a url')).toBeUndefined();
    expect(sanitizeReferrer(undefined)).toBeUndefined();
    expect(sanitizeReferrer(42)).toBeUndefined();
    expect(sanitizeReferrer({ toString: () => 'https://x.test' })).toBeUndefined();
    expect(sanitizeReferrer(`https://x.test/${'a'.repeat(600)}`)).toBeUndefined();
  });
});
