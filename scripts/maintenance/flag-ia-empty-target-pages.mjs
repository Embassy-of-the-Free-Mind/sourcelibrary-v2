#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-ia-ocr-leaf-offset.mjs `--clear-empty` (sets `ocr: null`
 * on the same pages — destroys the served text and makes the page eligible for a paid model read;
 * Derek deferred that as a separate decision, 2026-09-13); scripts/maintenance/withhold-stale-
 * translations.mjs (withholds a TRANSLATION; the text at issue here is the transcription). The
 * `ocr.unreadable` flag it sets is the #4523 contract (src/lib/types/page.ts OcrData.unreadable):
 * data kept for provenance, not served, not counted, its translation withheld by the standing sweep.
 *
 * flag-ia-empty-target-pages — mark the leaf-repair's EMPTY-TARGET pages as untrusted (#4790).
 *
 * WHY. When repair-ia-ocr-leaf-offset.mjs re-pointed 39 CLASS A books to leaf offset 0, 30 pages
 * had no words on their own leaf in the Archive's OCR (a Google-scanned `<HIDDENTEXT/>` leaf). The
 * repair left them alone — so they still carry the NEIGHBOURING leaf's text, served to readers and
 * about to be translated, embedded and cited. Clearing them is a spend decision (30 model reads);
 * flagging them `ocr.unreadable` gates them now without deciding that: the reader withholds the
 * pane, page-counts stop counting them, translate-core skips them, and stale-translation.mjs
 * withholds any translation already made of them. Reversible: unset the two fields.
 *
 * Idempotent; a page already flagged, no longer `ia_djvu`, or without text is skipped and counted.
 * One `page_revisions` row per flagged page (the text is unchanged, but the doctrine is "snapshot
 * before a write to `ocr`"), one sweep_log row per book, and the book's page counters recounted.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/flag-ia-empty-target-pages.mjs --from <leaf-repair-progress.empty-targets.jsonl>
 *   node scripts/maintenance/flag-ia-empty-target-pages.mjs --from <…> --apply
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const FROM = arg('--from', null);
if (!FROM) { console.error('--from <empty-targets.jsonl> is required (written by repair-ia-ocr-leaf-offset.mjs)'); process.exit(2); }
const SOURCE = 'ia_djvu', SWEEP = 'ia-ocr-empty-target-flag-2026-09', UNREADABLE_REASON = 'ia_wrong_leaf_empty_target_4790';

const rows = fs.readFileSync(FROM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byBook = new Map();
for (const r of rows) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
console.log(`${rows.length} empty-target pages in ${byBook.size} books (${APPLY ? 'APPLY' : 'dry run'})`);

await withMongo(async (db) => {
  const P = db.collection('pages'), B = db.collection('books');
  const totals = { books: 0, flagged: 0, already: 0, not_ia: 0, no_text: 0, missing: 0 };
  for (const [bookId, list] of byBook) {
    const pages = await P.find({ book_id: bookId, id: { $in: list.map((r) => r.page_id) } }, { projection: { id: 1, page_number: 1, 'ocr.source': 1, 'ocr.unreadable': 1, 'ocr.data': 1 } }).toArray();
    const todo = [];
    for (const r of list) {
      const p = pages.find((x) => x.id === r.page_id);
      if (!p) { totals.missing++; continue; }
      if (p.ocr?.unreadable === true) { totals.already++; continue; }
      if (p.ocr?.source !== SOURCE) { totals.not_ia++; continue; }
      if (!p.ocr?.data) { totals.no_text++; continue; }
      todo.push(p);
    }
    totals.books++;
    console.log(`  ${bookId} pages ${list.length} → flag ${todo.length}${todo.length ? ` (p. ${todo.map((p) => p.page_number).join(', ')})` : ''}`);
    if (!APPLY || !todo.length) { totals.flagged += todo.length; continue; }
    const now = new Date();
    await saveRevisionsBeforeOverwrite(db, todo.map((p) => p.id), 'ocr', { reason: UNREADABLE_REASON });
    const res = await P.bulkWrite(todo.map((p) => ({ updateOne: {
      filter: { _id: p._id, 'ocr.source': SOURCE, 'ocr.unreadable': { $ne: true } },
      update: { $set: { 'ocr.unreadable': true, 'ocr.unreadable_reason': UNREADABLE_REASON, updated_at: now } },
    } })), { ordered: false });
    totals.flagged += res.modifiedCount;
    const [counts] = await P.aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
    if (counts) await B.updateOne({ id: bookId }, { $set: { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation, updated_at: now } });
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'flagged-unreadable', detail: { pages: res.modifiedCount, page_numbers: todo.map((p) => p.page_number), reason: UNREADABLE_REASON, pages_ocr_after: counts?.with_ocr ?? null } });
  }
  console.log(JSON.stringify({ ...totals, apply: APPLY }));
});
