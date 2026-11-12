// PRIOR ART: scripts/lib/lane-book-list.mjs (lane_job_books: which books a job took, recorded AFTER it loads them —
// "a record, not a lock", nothing reads it to skip a book) and agy-pools.mjs's per-pool busy file (one box only).
/**
 * Book claims (#8550): a lease on one book, held by one run on any box, so two lanes do not read and write the same
 * book at once.
 *
 * Why: near-bar-8529 (clawdbot) and the gex45 :40 finish cron both ran `cli-translate-lane finish` over the same idle
 * books. Nothing marked a book as being worked on, so both read it and both wrote it: of 8,873 writes, 2,463 re-wrote
 * identical text and 624 replaced English another run had written a median 1.7 min earlier (131 books), and every
 * duplicate read spent agy quota.
 *
 * One document per claimed book in `book_claims`: { _id: 'book:<id>', holder, box, job, at, until }. A claim is taken
 * when no document exists, its lease has expired, or this holder already has it; otherwise it is refused, atomically
 * (the upsert's duplicate-key error is the refusal). Leases are short (default 30 min) and renewed per chunk, so a run
 * that dies frees its books within the lease. A TTL index removes expired documents; it is not relied on for
 * correctness (the `until` filter is).
 *
 * Best effort on infrastructure errors: if the claim cannot be read or written (Mongo hiccup), `claimBook` returns
 * `{ ok: true, degraded: true }`, so the lane runs as before rather than stopping. cli-translate.mjs apply's
 * "English changed since the read" guard is the backstop.
 */
import os from 'node:os';
import { contentHash } from './write-provenance.mjs';

export const BOOK_CLAIMS = 'book_claims';
export const DEFAULT_LEASE_MS = 30 * 60_000;

/** This run's holder id: box, pid and start time, so two runs on one box are different holders. */
export function holderId(job = process.env.JOB_NAME || 'manual', now = Date.now()) {
  return `${os.hostname()}:${process.pid}:${now}:${job}`;
}

/** The filter and update for one claim, pure (the test pins it). */
export function claimOp({ bookId, holder, job, leaseMs = DEFAULT_LEASE_MS, now = new Date(), box = os.hostname() }) {
  return {
    filter: { _id: `book:${bookId}`, $or: [{ until: { $lt: now } }, { holder }] },
    update: { $set: { holder, box, job: job ?? null, at: now, until: new Date(now.getTime() + leaseMs) } },
  };
}

let indexed = false;
async function ensureIndex(col) {
  if (indexed) return;
  indexed = true;
  try { await col.createIndex({ until: 1 }, { expireAfterSeconds: 0, name: 'until_ttl' }); } catch { /* exists, or no rights: the filter is what matters */ }
}

/**
 * Take (or renew) the lease on a book. Returns { ok: true } when this holder now has it, { ok: false, by } when another
 * live run holds it, { ok: true, degraded: true, error } when the claim store could not be reached.
 */
export async function claimBook(db, { bookId, holder, job, leaseMs = DEFAULT_LEASE_MS, now = new Date() }) {
  const col = db.collection(BOOK_CLAIMS);
  await ensureIndex(col);
  const { filter, update } = claimOp({ bookId, holder, job, leaseMs, now });
  try {
    await col.updateOne(filter, update, { upsert: true });
    return { ok: true };
  } catch (e) {
    if (e?.code === 11000) {
      const cur = await col.findOne({ _id: `book:${bookId}` }).catch(() => null);
      return { ok: false, by: cur ? { holder: cur.holder, box: cur.box, job: cur.job, until: cur.until } : null };
    }
    return { ok: true, degraded: true, error: String(e?.message || e) };
  }
}

/** Give a book back (only if this holder has it). */
export async function releaseBook(db, { bookId, holder }) {
  try { await db.collection(BOOK_CLAIMS).deleteOne({ _id: `book:${bookId}`, holder }); } catch { /* the lease expires anyway */ }
}

/** Give back every book this holder has (end of run). */
export async function releaseAll(db, holder) {
  try { await db.collection(BOOK_CLAIMS).deleteMany({ holder }); } catch { /* the leases expire anyway */ }
}

// ── the write-side backstop (#8550), used by cli-translate.mjs apply ──
/** The page's English as a read found it (null = none), recorded in the read's meta as `translation_hash`. */
export const translationHashOf = (page) => (page?.translation?.data && /\S/.test(page.translation.data) ? contentHash(page.translation.data) : null);

/** Why `apply` must not write this read over the page's current English, or null. */
export function englishChangedSinceRead(meta, page) {
  const now = translationHashOf(page);
  if (Object.prototype.hasOwnProperty.call(meta, 'translation_hash')) return now !== meta.translation_hash ? 'English changed since the read' : null;
  // A read made before translation_hash was recorded (claude-translate.mjs, older reads): refuse only English written
  // after the read started.
  const at = page?.translation?.updated_at ? new Date(page.translation.updated_at) : null;
  return now && at && meta.started_at && at > new Date(meta.started_at) ? 'English written by another run since the read' : null;
}
