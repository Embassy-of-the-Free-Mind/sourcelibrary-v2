/**
 * embed-watermark — the incremental selection rule for embed-gemini (#5869).
 *
 * PRIOR ART: embed-gemini.mjs getLastSyncTime() — the rule this replaces. It
 * took max(updated_at) over ALL of page_translations, a store every embedder
 * writes (enrich-worker Phase 6 inline, envelope-scoped runs, --book runs), so
 * any of them could push the mark past pages the cron had never read, and
 * those pages were never selected again. Measured 2026-10-05: ~910K translated
 * pages on live books with no vector. scripts/lib/versioned-config.mjs is the
 * write door used here; nothing existing owned a per-worker watermark.
 *
 * THE RULE. The worker owns its mark, in Mongo `system_config` (_id
 * WATERMARK_ID), and nobody else writes it. A run selects pages whose source
 * timestamp (translation.updated_at or ocr.updated_at) is after the mark. The
 * mark advances ONLY after a run that was:
 *   - unscoped   (no --book / --books-file / envelope confinement / worker shard),
 *   - complete   (no --limit cut it short),
 *   - error-free (every selected page upserted),
 * and only to the newest source timestamp that run actually READ — capped at
 * run start minus COMMIT_MARGIN_MS, because a page written just before the run
 * may not have been visible to the cursor when it passed that page's position.
 * Re-reading a few pages next run costs a fraction of a cent; skipping one is
 * forever. The mark never moves backward.
 *
 * It is never derived from page_translations: a store with several writers
 * cannot tell one writer what it has read.
 */

import { updateConfigVersioned } from './versioned-config.mjs';

export const WATERMARK_ID = 'embed_gemini_watermark';
export const COMMIT_MARGIN_MS = 15 * 60 * 1000;

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Newest source timestamp on a page — what the incremental filter compares. */
export function pageSourceTs(page) {
  const t = toDate(page?.translation?.updated_at);
  const o = toDate(page?.ocr?.updated_at);
  if (t && o) return t > o ? t : o;
  return t || o || null;
}

/** Mongo clause selecting pages whose source changed after `watermark`. */
export function incrementalSourceFilter(watermark) {
  return {
    $or: [
      { 'translation.updated_at': { $gt: watermark } },
      { 'ocr.updated_at': { $gt: watermark } },
    ],
  };
}

/**
 * Where the mark should move after a run, or null to leave it alone.
 * @param {object} run
 * @param {Date|null} run.prior        current mark
 * @param {Date|null} run.maxReadTs    newest pageSourceTs() the run read
 * @param {Date}      run.startedAt    when the run began selecting
 * @param {boolean}   run.scoped       any confinement of the book set
 * @param {boolean}   run.limited      --limit stopped it early
 * @param {number}    run.errors       pages that failed to embed or upsert
 */
export function nextWatermark({ prior, maxReadTs, startedAt, scoped, limited, errors }) {
  if (scoped || limited || errors > 0) return null;
  const read = toDate(maxReadTs);
  const start = toDate(startedAt);
  if (!read || !start) return null;
  const cap = new Date(start.getTime() - COMMIT_MARGIN_MS);
  const next = read < cap ? read : cap;
  const p = toDate(prior);
  if (p && next <= p) return null;
  return next;
}

export async function readWatermark(db) {
  const doc = await db.collection('system_config').findOne({ _id: WATERMARK_ID });
  return toDate(doc?.source_ts);
}

export async function writeWatermark(db, ts, changedBy) {
  return updateConfigVersioned(
    db,
    WATERMARK_ID,
    { $set: { source_ts: ts, updated_at: new Date() } },
    changedBy,
  );
}
