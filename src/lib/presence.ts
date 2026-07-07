/**
 * Live reader presence — shared constants + helpers for the "N people are
 * reading right now" feature (issue #3059).
 *
 * Design invariants (read before touching):
 *  - AGGREGATE ONLY. We store one anonymous, self-expiring doc per browser
 *    (`visitor_id`, a random localStorage UUID never tied to a login). We
 *    never expose who is reading — only how many, and a sample of *which
 *    books* are open right now.
 *  - Titles shown next to the count are looked up SERVER-SIDE from the
 *    `books` collection (visible:true only). The client sends a book
 *    slug/id, never a title — otherwise a crafted heartbeat could inject
 *    arbitrary or hidden-book text onto the homepage.
 *  - The `presence` collection is the sanctioned exception to the no-TTL
 *    policy (see feedback_no_automated_data_retention): heartbeats self-prune
 *    via a TTL index on `expireAt`.
 *  - No presence UI or heartbeat runs on tenant subdomains (BPH/EFM stay
 *    closed systems) — that gate lives in the client component.
 */

import type { Db } from 'mongodb';

export const PRESENCE_COLLECTION = 'presence';

/** Client heartbeat cadence. Exported so the component and the windows agree. */
export const HEARTBEAT_MS = 50_000;

/**
 * A visitor counts as "reading now" if we've heard from them within this
 * window — ~2.5 missed heartbeats of tolerance so a brief network blip or a
 * backgrounded tab doesn't drop them.
 */
export const ACTIVE_WINDOW_MS = 130_000;

/**
 * TTL horizon written to each doc's `expireAt`. Strictly LONGER than
 * ACTIVE_WINDOW_MS (plus Mongo's ~60s TTL sweep lag) so a doc that's still
 * inside the active window is never pruned out from under the count.
 */
export const TTL_MS = 180_000;

/**
 * Below this many concurrent readers we don't surface any book titles — a
 * lone reader on a rare book shouldn't be singled out. The count itself is
 * always aggregate; the client softens tiny counts in copy.
 */
export const TITLES_FLOOR = 3;

/** Most titles to sample for the "…including X, Y, and N others" line. */
export const TITLES_MAX = 6;

/** Anonymous visitor id shape (UUID). */
export const VISITOR_ID_RE = /^[0-9a-f-]{36}$/i;

/** Book slug/id shape — same safe charset the views API uses for target ids. */
export const BOOK_KEY_RE = /^[\w:.-]{1,128}$/;

// TTL index is created lazily and memoized (repo convention — see
// src/lib/rate-limit.ts). A rejected promise is not cached, so a transient
// failure can be retried on the next call.
let presenceIndexReady: Promise<void> | null = null;
export async function ensurePresenceIndex(db: Db): Promise<void> {
  if (!presenceIndexReady) {
    presenceIndexReady = (async () => {
      const coll = db.collection(PRESENCE_COLLECTION);
      // One doc per browser — upserts key on visitor_id.
      await coll.createIndex({ visitor_id: 1 }, { unique: true });
      // Self-pruning heartbeats (sanctioned no-TTL exception, #3059).
      await coll.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
      // Supports the active-window count/title queries.
      await coll.createIndex({ updated_at: 1 });
    })().catch((e) => {
      presenceIndexReady = null;
      throw e;
    });
  }
  return presenceIndexReady;
}

export interface PresenceSnapshot {
  /** Distinct humans active within ACTIVE_WINDOW_MS. */
  count: number;
  /** Sample of visible-book titles open right now (empty below the floor). */
  titles: string[];
}

/**
 * Read the current aggregate presence: how many distinct visitors are active,
 * and a sample of which visible books they're reading. All filtering happens
 * here so both the read path and any test share one source of truth.
 */
export async function getPresenceSnapshot(db: Db): Promise<PresenceSnapshot> {
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const coll = db.collection(PRESENCE_COLLECTION);

  const count = await coll.countDocuments({ updated_at: { $gt: activeSince } });

  if (count < TITLES_FLOOR) {
    return { count, titles: [] };
  }

  // Distinct book keys currently open, most-read first.
  const grouped = await coll
    .aggregate<{ _id: string; readers: number }>([
      { $match: { updated_at: { $gt: activeSince }, book: { $type: 'string' } } },
      { $group: { _id: '$book', readers: { $sum: 1 } } },
      { $sort: { readers: -1 } },
      { $limit: TITLES_MAX * 3 }, // over-fetch; some keys may be hidden/stale
    ])
    .toArray();

  const keys = grouped.map((g) => g._id).filter((k) => BOOK_KEY_RE.test(k));
  if (keys.length === 0) return { count, titles: [] };

  // Resolve titles server-side, visible books only. Never trust a client title.
  const books = await db
    .collection('books')
    .find(
      { $or: [{ slug: { $in: keys } }, { id: { $in: keys } }], visible: true },
      { projection: { _id: 0, id: 1, slug: 1, title: 1 } }
    )
    .toArray();

  // Map every resolvable key → title, then walk `grouped` to keep read-order.
  const titleByKey = new Map<string, string>();
  for (const b of books) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) continue;
    if (typeof b.slug === 'string') titleByKey.set(b.slug, title);
    if (typeof b.id === 'string') titleByKey.set(b.id, title);
  }

  const seen = new Set<string>();
  const titles: string[] = [];
  for (const g of grouped) {
    const title = titleByKey.get(g._id);
    if (title && !seen.has(title)) {
      seen.add(title);
      titles.push(title);
      if (titles.length >= TITLES_MAX) break;
    }
  }

  return { count, titles };
}
