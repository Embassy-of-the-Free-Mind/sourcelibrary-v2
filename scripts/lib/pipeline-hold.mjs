// PRIOR ART: scripts/workers/lib/selective-unpause.mjs (an ALLOW list — which books may run while
// the line is paused; it cannot keep one named book out of an open lane); `system_config.
// processing_control.paused_phases` (pauses a PHASE for every book); the `parked` / `needs_attention`
// statuses (terminal parks that record neither where the book came from nor when it may leave, and
// that a human or a retry sweep may lift without knowing why it was there). None of them can hold a
// NAMED book out of EVERY lane, remember its prior status, say why, and be audited for drift.
//
// pipeline-hold — keep a book out of every pipeline lane until a named condition is met (#4790).
//
// WHY A STATUS, NOT A FILTER. Every worker selects books by `pipeline_auto.status` — the
// orchestrator's phases, translate-worker, enrich-worker, batch-collector — so a book whose status
// is `held` is invisible to all of them with no query changed. A `derived_hold` flag would instead
// have to be added to every selection query, and the surface you forget is the one that runs
// (`derived-metadata-lane.md`: "a filter list is a list of the surfaces you thought of").
//
// WHAT CAN STILL GO WRONG is a WRITER, not a reader: a code path that sets `pipeline_auto.status`
// unconditionally (a rollback, a batch write-back) would lift the hold by accident. So the hold is
// ALSO a marker, `pipeline_auto.hold`, and the status writers consult it: the orchestrator's
// `setPipelineStatus` refuses any status but `held` while the marker is present, and the direct
// `updateOne` writers filter on `NOT_HELD`. `scripts/audit/pipeline-hold-drift.mjs` reconciles the
// two (a marker without the status = CLOBBERED) so a writer this file does not know about is found
// within a day rather than never.
//
// A hold is not a fact about the book; it is a decision with a reason, a date and a release
// condition, and it leaves a `book_events` row at both ends. Release restores exactly the status
// the book was holding at.

import { ensurePages, isLazyPagesBook } from './lazy-pages.mjs';

export const HOLD_STATUS = 'held';
export const HOLD_EVENT = 'pipeline_hold';
export const RELEASE_EVENT = 'pipeline_release';
export const HOLD_SWEEP = 'pipeline-hold-2026-09';

/** Mongo filter fragment: spread into any status-writing `updateOne` filter so it cannot lift a hold. */
export const NOT_HELD = { 'pipeline_auto.hold': { $exists: false } };

/**
 * SPLIT BEFORE READ (#7605). A book flagged `needs_splitting` and not yet `split_completed` serves two leaves (or a
 * pecha frame of several) per page image. No OCR or translation lane may read it: whole-spread reads drop text at the
 * seam (#6099), invent lines between leaves (#6948) and cannot be cited by page (#5771). In the 14 days to
 * 2026-10-28 five writers did anyway (paddle-print 2,488 pages, Phase 2's spread prompt 1,149, cli-ocr 368,
 * Yigdzin 753, cli-translate 177). The splitters (split-book, split-pecha) are the only readers of these books.
 * A page that is already a leaf (cut from a spread, or cropped) is not refused, whatever the book flag says.
 */
export const UNSPLIT_SPREAD = Object.freeze({ needs_splitting: true, split_completed: { $ne: true } });
/** Spread into a book selector so it cannot pick an unsplit spread book. Uses `$nor`, so it composes with `$or`. */
export const NOT_UNSPLIT_SPREAD = Object.freeze({ $nor: [{ needs_splitting: true, split_completed: { $ne: true } }] });
export const isUnsplitSpread = (book) => book?.needs_splitting === true && book?.split_completed !== true;
export const isLeafPage = (page) => !!(page?.split_from_spread || page?.split_from_pecha || page?.cropped_photo || page?.crop);
/** Why this page may not be read (a sentence), or null. `book` needs `needs_splitting` and `split_completed`. */
export function unsplitReadRefusal(book, page) {
  if (!isUnsplitSpread(book) || isLeafPage(page)) return null;
  return 'book needs_splitting and is not split: split it first (split-book.mjs --gutter-only / split-pecha.mjs), #7605';
}

/**
 * ARCHIVING IGNORES THE HOLD (#5448 step 3). A hold stops paid OCR and translation; fetching a
 * book's page images to R2 costs storage only, and a held book still needs its images preserved
 * (preservation-policy.md). Containment holds are about TEXT, not images. So the archivers never
 * filter on the hold. But the importers of held waves also set `archive_metadata.blocked` — the
 * archivers' own "never fetch this book" flag — with a reason naming the hold, and that kept
 * ~5.2K held books (1.43M pages, measured 2026-10-25) out of every archiver.
 *
 * This is the reason text of those two importers: the tier-A wave (#7343, "… pipeline hold
 * acquisition-wave-2026-10b …") and wave-import.mjs ("<campaign>: hidden acquisition, images
 * hot-linked"). A block for any other reason (401/403, a dead source, 5 failed bulk runs) still
 * excludes the book: an archiver that fails overwrites the reason with its own.
 */
export const HOLD_ONLY_ARCHIVE_BLOCK = /pipeline hold|hidden acquisition, images hot-linked/;

/**
 * Spread into an ARCHIVE selector in place of `'archive_metadata.blocked': { $ne: true }`: the book
 * is not blocked, or is blocked only because it is held. Uses `$nor` so it composes with a
 * selector's own `$or` / `$and`.
 */
export const ARCHIVE_NOT_BLOCKED = Object.freeze({
  $nor: [{ 'archive_metadata.blocked': true, 'archive_metadata.blocked_reason': { $not: HOLD_ONLY_ARCHIVE_BLOCK } }],
});

/** Does this book carry a hold marker? (The status alone is not the test — see holdViolation.) */
export function isHeld(book) {
  return !!book?.pipeline_auto?.hold;
}

/**
 * Why a status write on this book must be refused, or null when it may proceed.
 * A held book accepts only `held` (re-asserting the hold) — anything else, including the status it
 * was holding at, goes through releaseBook so the release is recorded.
 */
export function holdViolation(book, nextStatus) {
  if (!isHeld(book)) return null;
  if (nextStatus === HOLD_STATUS) return null;
  const h = book.pipeline_auto.hold;
  return `book is held (${h.reason}${h.issue ? ` #${h.issue}` : ''}, since ${h.held_at instanceof Date ? h.held_at.toISOString().slice(0, 10) : h.held_at}); refusing status '${nextStatus}' — release it with scripts/maintenance/hold-pipeline-books.mjs --release`;
}

/**
 * Hold one book. Idempotent: a book already held for the same reason is left alone (returns
 * `already_held`); a book held for a DIFFERENT reason is also left alone and reported, because two
 * holds would need two releases and this records only one.
 *
 * @param {import('mongodb').Db} db
 * @param {string} bookId  `books.id`
 * @param {{ reason: string, issue?: number, release: string, detail?: object, source?: string }} hold
 *   reason   kebab-case label, e.g. 'ia-wrong-leaf-4790'
 *   release  one sentence saying what has to be true before the hold may be lifted
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ outcome: 'held'|'already_held'|'held_other_reason'|'not_found'|'dry_run', from?: string }>}
 */
export async function holdBook(db, bookId, hold, { dryRun = false } = {}) {
  if (!hold?.reason || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(hold.reason)) throw new TypeError(`holdBook: reason must be kebab-case, got ${JSON.stringify(hold?.reason)}`);
  if (!hold.release) throw new TypeError('holdBook: a hold needs a release condition');
  const B = db.collection('books');
  const book = await B.findOne({ id: bookId }, { projection: { id: 1, title: 1, pipeline_auto: 1 } });
  if (!book) return { outcome: 'not_found' };
  if (isHeld(book)) return { outcome: book.pipeline_auto.hold.reason === hold.reason ? 'already_held' : 'held_other_reason', from: book.pipeline_auto.hold.held_from_status };
  const from = book.pipeline_auto?.status ?? null;
  if (dryRun) return { outcome: 'dry_run', from };
  const now = new Date();
  const marker = { reason: hold.reason, issue: hold.issue ?? null, held_at: now, held_from_status: from, release: hold.release, detail: hold.detail ?? null };
  const r = await B.updateOne(
    { id: bookId, ...NOT_HELD },
    { $set: { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold': marker, 'pipeline_auto.last_updated': now, updated_at: now } },
  );
  if (r.modifiedCount !== 1) return { outcome: 'already_held', from };
  await db.collection('book_events').insertOne({ book_id: bookId, type: HOLD_EVENT, at: now, source: hold.source || 'pipeline-hold', details: { reason: hold.reason, issue: hold.issue ?? null, from_status: from, release: hold.release, ...(hold.detail || {}) } });
  await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: bookId, book_title: book.title, metadata: { from: from || 'none', to: HOLD_STATUS, source: hold.source || 'pipeline-hold', reason: hold.reason }, timestamp: now }).catch(() => {});
  return { outcome: 'held', from };
}

/**
 * Release one book: restore the status it was holding at, drop the marker, record the release.
 * `to` overrides the restored status (e.g. a book held at `complete` that must now re-flow from
 * `ocr_complete` because its pages changed underneath it).
 *
 * Releasing a manifest-only book (#7343 lazy pages) is the decision to dispatch it, so its pages
 * are created first, through the one materializer; if they cannot be, the book stays held
 * (`pages_not_ready`). Such a book was held before it ever enrolled, so with no prior status it
 * re-enters at `queued` (archive first), never at the `ocr_complete` default.
 *
 * `reason` releases ONLY a hold placed for that reason (#6871): a lane that releases the holds it placed must never
 * lift another decision's hold (`scans-only-publish-7270`, a containment hold …) that happens to sit on the same book.
 * A book held for another reason returns `held_other_reason`, and the update filter carries the reason too, so a hold
 * swapped in between the read and the write is not lifted either.
 */
export async function releaseBook(db, bookId, { note, to, source, reason } = {}, { dryRun = false } = {}) {
  const B = db.collection('books');
  const book = await B.findOne({ id: bookId }, { projection: { id: 1, title: 1, pipeline_auto: 1, pages_state: 1 } });
  if (!book) return { outcome: 'not_found' };
  if (!isHeld(book)) return { outcome: 'not_held', status: book.pipeline_auto?.status ?? null };
  const h = book.pipeline_auto.hold;
  if (reason != null && h.reason !== reason) return { outcome: 'held_other_reason', reason: h.reason };
  const lazy = isLazyPagesBook(book);
  const restore = to || h.held_from_status || (lazy || book.pages_state ? 'queued' : 'ocr_complete');
  if (dryRun) return { outcome: 'dry_run', to: restore, reason: h.reason, ...(lazy ? { materialize: true } : {}) };
  if (lazy) {
    try {
      await ensurePages(db, bookId, { trigger: 'ocr-dispatch' });
    } catch (e) {
      return { outcome: 'pages_not_ready', error: String(e?.message ?? e) };
    }
  }
  const now = new Date();
  const r = await B.updateOne(
    { id: bookId, ...(reason != null ? { 'pipeline_auto.hold.reason': reason } : { 'pipeline_auto.hold': { $exists: true } }) },
    { $set: { 'pipeline_auto.status': restore, 'pipeline_auto.last_updated': now, updated_at: now }, $unset: { 'pipeline_auto.hold': '' } },
  );
  if (r.modifiedCount !== 1) return { outcome: 'not_held' };
  await db.collection('book_events').insertOne({ book_id: bookId, type: RELEASE_EVENT, at: now, source: source || 'pipeline-hold', details: { reason: h.reason, issue: h.issue ?? null, held_at: h.held_at, to_status: restore, note: note || null } });
  await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: bookId, book_title: book.title, metadata: { from: HOLD_STATUS, to: restore, source: source || 'pipeline-hold', reason: h.reason }, timestamp: now }).catch(() => {});
  return { outcome: 'released', to: restore, reason: h.reason };
}
