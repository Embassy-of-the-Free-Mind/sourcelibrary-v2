// PRIOR ART: scripts/eval/page-marker-order.mjs (the #5699 detector this calls — a census runner, it
// reads a draw and writes jsonl, it decides nothing about one book); scripts/lib/ocr-trust-gate.mjs
// (refuses a book by STRATUM, not by what its own pages say); scripts/lib/printed-number-runs.mjs
// (fits printed-number lines for #8041 — a numbering map, not a hold). None of them stops one
// book stored back to front from being translated.
//
// page-order-gate — hold a book whose printed page numbers DESCEND before it is translated (#8068).
//
// WHY. A book stored back to front is translated with the wrong neighbour as context, and every
// derived lane (chapters, index, summary) inherits the order (#5699: 42 books renumbered by hand,
// 19,495 translated pages moved). Internet Archive's scan order is imported as is
// (`page_number: i + 1`) and its `page-progression` field does not predict a reversal, so the
// import cannot know; after OCR the printed numbers can say.
//
// WHAT IT READS. The served pages' OCR head and tail, through `analyseBook` — never `<page-num>`,
// which #5699 showed is invented on exactly these books. A DESC finding (a run of
// plausible descending steps, in storage order) of 5+ markers holds the book: 42 of 43 known
// descending books, 0 of 10 by-eye false positives, 0 of 598 random books (measured in
// scripts/eval/experiments/2026-11-08-page-order-gate-recall-8068.md). SWAP and JUMP are not held:
// none of the 7 known swapped books shows a 5-marker run, and JUMP is missing pages, not order.
//
// WHAT IT CANNOT SEE. A book with no running-head numbers (most recent OCR keeps the number in
// `<page-num>` only) or numbers in a script the parser does not read (Syriac letter numerals) gives
// no markers and passes. That is the Kitab Manafi gap; this gate narrows the hole, it does not close it.
//
// RELEASE. Renumber the book (scripts/maintenance/renumber-page-order.mjs), or confirm by eye that
// the run is not a reversal, then release it with hold-pipeline-books.mjs --release-held. A book
// with a release event for this reason is never held by the gate again: the eye has the last word.

import { analyseBook } from '../eval/page-marker-order.mjs';
import { holdBook, RELEASE_EVENT } from './pipeline-hold.mjs';

export const PAGE_ORDER_HOLD_REASON = 'page-order-descending-8068';
export const PAGE_ORDER_HOLD = Object.freeze({
  reason: PAGE_ORDER_HOLD_REASON,
  issue: 8068,
  release: 'the printed page numbers descend in storage order: check the flagged run against the page images; if the book (or a part) is back to front, renumber it with scripts/maintenance/renumber-page-order.mjs; then release it with scripts/maintenance/hold-pipeline-books.mjs --release-held --reason page-order-descending-8068 --book <id> --apply (a released book is not held by this gate again)',
  release_when: { kind: 'test', ref: 'by-eye check of the flagged run (renumber-page-order.mjs if reversed), then hold-pipeline-books.mjs --release-held --reason page-order-descending-8068' },
});

/**
 * A run must carry at least 5 descending markers to hold. The detector reports runs of 4; on the #5699 set every
 * false positive (6 of 10 by-eye "in order" books) had a longest run of exactly 4, and every descending book a run
 * of 5 or more (scripts/eval/experiments/2026-11-08-page-order-gate-recall-8068.md).
 */
export const MIN_RUN = 5;

/** Served pages' OCR head (700 chars) and tail (800), in storage order — the detector's own read. */
export async function readOrderPages(db, bookId, { pageNumberOf = null } = {}) {
  // A non-string ocr.data makes $strLenCP/$substrCP throw (#4272): only a $type check stops it.
  const ocr = { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] };
  const pages = await db.collection('pages').aggregate([
    // Served pages only: a negative page_number is a soft-hidden spread numbered -n, which sorts
    // in reverse and reads exactly like a book stored back to front.
    { $match: { book_id: bookId, page_number: { $gte: 0 } } },
    { $sort: { page_number: 1 } },
    { $project: { _id: 1, id: 1, page_number: 1, head: { $substrCP: [ocr, 0, 700] },
      tail: { $substrCP: [ocr, { $max: [0, { $subtract: [{ $strLenCP: ocr }, 800] }] }, 800] } } },
  ], { hint: { book_id: 1, page_number: 1 }, maxTimeMS: 120000 }).toArray();
  for (const p of pages) { p.id = String(p.id ?? p._id); delete p._id; }
  if (!pageNumberOf) return pages;
  // Measurement only: read the book in another order (e.g. its order before a renumber).
  return pages.map((p) => ({ ...p, page_number: pageNumberOf(p) })).sort((a, b) => a.page_number - b.page_number);
}

/** The gate's verdict on pages already read: { hold, desc_runs, markers_P, markers_S, ... }. */
export function pageOrderVerdict(pages) {
  const r = analyseBook(pages);
  const desc = r.findings.filter((f) => f.kind === 'DESC');
  return {
    hold: desc.some((f) => f.markers.length >= MIN_RUN),
    pages: r.pages, markers_P: r.markers_P, markers_S: r.markers_S,
    desc_runs: desc.map((f) => ({ ch: f.ch, from: f.from, to: f.to, n: f.markers.length, markers: f.markers.slice(0, 8) })),
    swap: r.swap, jump: r.jump,
  };
}

/**
 * Check one book before translation and hold it if its printed numbers descend.
 * Returns { outcome: 'pass'|'released_before'|'held'|'already_held'|'held_other_reason'|'dry_run', verdict? }.
 */
export async function pageOrderGate(db, book, { dryRun = false, source = 'pipeline-orchestrator' } = {}) {
  const released = await db.collection('book_events').findOne(
    { book_id: book.id, type: RELEASE_EVENT, 'details.reason': PAGE_ORDER_HOLD_REASON },
    { projection: { _id: 1 } },
  );
  if (released) return { outcome: 'released_before' };
  const verdict = pageOrderVerdict(await readOrderPages(db, book.id));
  if (!verdict.hold) return { outcome: 'pass', verdict };
  if (dryRun) return { outcome: 'dry_run', verdict };
  const r = await holdBook(db, book.id, {
    ...PAGE_ORDER_HOLD,
    source,
    detail: { desc_runs: verdict.desc_runs, markers_P: verdict.markers_P, markers_S: verdict.markers_S, pages: verdict.pages, language: book.language ?? null },
  });
  return { outcome: r.outcome, verdict };
}
