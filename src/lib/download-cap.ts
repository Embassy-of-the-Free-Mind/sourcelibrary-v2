import { getDb } from './mongodb';

/**
 * Daily free-tier download cap (#3290).
 *
 * The paid tier protects bulk export (the AI-licensing rate card's asset).
 * The free tier — text formats, free with sign-in — needed a cap of its own
 * so it can't be scripted into a corpus-exfiltration path: max 20 DISTINCT
 * books per rolling 24h per account, counted only across free-tier
 * downloads. Downloading the same book twice (or in several free formats)
 * counts once. Members, per-book purchasers, and editor/admin sessions are
 * exempt — the caller (the download routes) checks those and only calls
 * this helper for accounts that aren't.
 *
 * Storage: `download_events` collection in the `bookstore` db, one doc per
 * (user_id, book_id) download event with a `ts` Date. No TTL index — repo
 * policy (#2976) forbids automated retention; prune manually if the
 * collection ever needs pruning. At scale a compound index on
 * `{ user_id: 1, ts: -1 }` would speed the rolling-window query below; not
 * created here — this repo does index/schema changes as explicit ops, not
 * inline in application code.
 */

const CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DAILY_FREE_BOOK_CAP = 20;

export interface DownloadCapResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Checks the caller's rolling-24h distinct-book count against the daily free
 * cap. If under the cap (or the book is already counted in the window), the
 * download is allowed and this download event is recorded. If at the cap AND
 * this is a new book, the download is rejected and nothing is recorded.
 */
export async function checkAndRecordDownload(
  userId: string,
  bookId: string,
): Promise<DownloadCapResult> {
  const db = await getDb();
  const events = db.collection('download_events');
  const since = new Date(Date.now() - CAP_WINDOW_MS);

  const distinctBooks = await events.distinct('book_id', {
    user_id: userId,
    ts: { $gte: since },
  });
  const alreadyCounted = distinctBooks.includes(bookId);

  if (!alreadyCounted && distinctBooks.length >= DAILY_FREE_BOOK_CAP) {
    return { allowed: false, remaining: 0 };
  }

  await events.insertOne({ user_id: userId, book_id: bookId, ts: new Date() });

  const newCount = alreadyCounted ? distinctBooks.length : distinctBooks.length + 1;
  return { allowed: true, remaining: Math.max(0, DAILY_FREE_BOOK_CAP - newCount) };
}
