#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/drebbel-oven-5811.mjs (branch job/drebbel-oven-5811, never merged to
 * main) — the same priority lever and progress readout for that job's 12 books; its id list is
 * hard-coded and this job's 9 books are not in it. hold-pipeline-books.mjs and set-scope.mjs are
 * used as-is for the hold/release and the envelope.
 *
 * drebbel-later-5811 — one-off job helper for #5811 (later history of Drebbel's oven).
 *
 *   --status     read-only: per-book status, archived/OCR/translated counts, visibility
 *   --priority   set processing_priority 85 on this job's books (dry run unless --apply). Phase 4
 *                (and 2, 8) take the top N books corpus-wide BEFORE confining to the envelope, so an
 *                envelope book outside the global top 60 is never selected (see drebbel-oven-5811).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/drebbel-later-5811.mjs --status
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'drebbel-later-5811';
export const IDS = [
  '6ac382f8ec4f0327ed602d98', // Graves, hatching at Cairo (RS RBO/3/78)
  '6ac382fcec4f0327ed602d9c', // Monconys, Egyptian ovens (RS CLP/17/3)
  '6ac382e5966464312757c22a', // Birch III
  '6ac382e7966464312757c442', // Birch IV
  '6ac382e9966464312757c682', // Réaumur, Art de faire éclorre I
  '6ac382eb966464312757c803', // Réaumur II
  '6ac382ee966464312757c976', // Réaumur, Art of Hatching (1750)
  '6ac382ef966464312757cb83', // Bolton 1900
  '6ac382f2966464312757cbf8', // Boyle, Usefulnesse 1663
  '6ac391b421755a8abfd8e653', // Phil. Trans. vols 11-12 (1676-78): prints Graves, Cairo ovens
  '6ac39a92693fbfc19e37bb27', // Phil. Trans. vol 4 (1669)
  '6ac39ad74bd5d854980237ff', // Phil. Trans. vol 5 (1670)
  '6ac39abdb102376559ba75ed', // Phil. Trans. vol 6 (1671)
];
const extra = (() => { const i = process.argv.indexOf('--also'); return i > 0 ? process.argv[i + 1].split(',') : []; })();
const ids = [...IDS, ...extra];

await withMongo(async (db) => {
  const B = db.collection('books');
  if (process.argv.includes('--status')) {
    const rows = await B.find({ id: { $in: ids } }).project({ id: 1, title: 1, slug: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, processing_priority: 1, 'pipeline_auto.status': 1, language: 1 }).toArray();
    for (const b of rows) {
      const [arch, ocr, tr] = await Promise.all([
        db.collection('pages').countDocuments({ book_id: b.id, archived_photo: { $exists: true, $ne: null } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ book_id: b.id, 'translation.data': { $exists: true, $ne: '' } }),
      ]);
      console.log(`${b.id} ${String(b.pipeline_auto?.status).padEnd(16)} p${b.processing_priority ?? '-'} ${b.visible ? 'VISIBLE' : 'hidden '} arch ${arch}/${b.pages_count} ocr ${ocr} tr ${tr} ${b.language} ${(b.title || '').slice(0, 50)} /book/${b.slug}`);
    }
  }
  // Same route drebbel-oven-5811 used for Evelyn II: archive.org answers HTTP 500 for the item's
  // JP2 zip while single /page/nN images serve 200, so archive-bulk strikes it toward BLOCKED.
  // bulk_unsuitable is the archiver's own "zip unusable, pages fetchable" → per-page IIIF route.
  if (process.argv.includes('--per-page')) {
    const id = process.argv[process.argv.indexOf('--per-page') + 1];
    const reason = 'archive.org HTTP 500 on the JP2 zip on every attempt 2026-10-05, single page images 200 (#5811)';
    console.log(`${id} ${APPLY ? 'SET' : 'would set'} archive_metadata.bulk_unsuitable — ${reason}`);
    if (APPLY) {
      await B.updateOne({ id }, {
        $set: { 'archive_metadata.bulk_unsuitable': true, 'archive_metadata.bulk_unsuitable_at': new Date(), 'archive_metadata.bulk_unsuitable_reason': reason, updated_at: new Date() },
        $unset: { 'archive_metadata.bulk_failures': '', 'archive_metadata.bulk_last_error': '', 'archive_metadata.bulk_last_failed_at': '' },
      });
      await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'bulk_unsuitable', detail: { reason } });
    }
  }
  if (process.argv.includes('--priority')) {
    const before = await B.find({ id: { $in: ids } }).project({ id: 1, processing_priority: 1 }).toArray();
    console.log(`${APPLY ? 'SET' : 'would set'} processing_priority 85 on ${before.length} books; before:`, JSON.stringify(before.map((b) => [b.id, b.processing_priority ?? null])));
    if (APPLY) {
      await B.updateMany({ id: { $in: ids } }, { $set: { processing_priority: 85, updated_at: new Date() } });
      for (const b of before) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'processing_priority', detail: { before: b.processing_priority ?? null, after: 85 } });
    }
  }
});
