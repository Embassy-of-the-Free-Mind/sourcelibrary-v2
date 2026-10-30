#!/usr/bin/env node
// PRIOR ART: scripts/split-book.mjs (its AR gate sets needs_splitting:false + split_note on portrait books, but only for
// the one book it is run on, from aspect ratios alone); scripts/maintenance/split-spreads-agy.mjs (#7454: splits, never
// unflags). Nothing clears the flag from a census of the images; this does, from scripts/audit/spread-confirm.mjs output.
/**
 * Clear `needs_splitting` on books whose frames are single pages (#7605 step 3).
 *
 * The split-before-read guard (pipeline-hold.mjs UNSPLIT_SPREAD) holds every flagged book out of OCR and translation.
 * spread-confirm.mjs asked agy Flash low about three pages of each of the 886 flagged books (2026-10-28); 26 came back
 * `single` on every sample. Opened by eye: a Sharada birch-bark leaf, a Sanskrit paper leaf and a Latin manuscript
 * spread (the last a `multi`, for contrast) read as the census says.
 *
 * Left alone, whatever the census says: Tibetan books (pecha frames belong to split-pecha.mjs, #5771) and
 * museumsofindia books (split-spreads-agy.mjs splits those with every cut checked by eye, #7454).
 *
 * ACTUATION: clearing the flag releases the book to every OCR/translation lane at its next cycle (orchestrator Phase 2,
 * cli-ocr, paddle-print). Books still `parked` or `held` stay out for those reasons.
 *
 *   node --env-file=.env.production.local scripts/maintenance/unflag-single-frames-7605.mjs --census FILE [--apply]
 *   node --env-file=.env.production.local scripts/maintenance/unflag-single-frames-7605.mjs --revert [--apply]
 * Dry run unless --apply. Each change writes a sweep_log row (sweep 'unflag-single-frames-7605'); --revert sets the
 * flag back on exactly those books.
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const CENSUS = arg('--census', null);
const SWEEP = 'unflag-single-frames-7605';
const NOTE = '#7605 spread-confirm: every sampled frame one page (agy gemini-3.8-flash-low, 2026-10-28)';

await withMongo(async (db) => {
  if (REVERT) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'unflagged-needs-splitting' }).toArray();
    const ids = [...new Set(rows.map((r) => r.book_id))];
    console.log(`${ids.length} books to re-flag${APPLY ? '' : ' (dry run)'}`);
    if (!APPLY) return;
    const r = await db.collection('books').updateMany({ id: { $in: ids }, needs_splitting: false, split_note: NOTE }, { $set: { needs_splitting: true }, $unset: { split_note: '' } });
    await recordSweepActions(db, ids.map((book_id) => ({ sweep: SWEEP, book_id, action: 'reverted' })));
    console.log(`re-flagged ${r.modifiedCount}`);
    return;
  }
  if (!CENSUS) { console.error('--census FILE is required'); process.exit(2); }
  const rows = fs.readFileSync(CENSUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const moi = new Set((await db.collection('books').find({ 'image_source.provider': 'museumsofindia' }, { projection: { id: 1 } }).toArray()).map((b) => b.id));
  const picked = rows.filter((r) => r.verdict === 'single' && !/tibetan/i.test(r.language || '') && !moi.has(r.book_id));
  console.log(`census: ${rows.length} books, ${rows.filter((r) => r.verdict === 'single').length} single, ${picked.length} after leaving Tibetan to #5771 and museumsofindia to #7454`);
  for (const r of picked) console.log(`  ${r.book_id}  ${String(r.language).padEnd(9)} ${String(r.status).padEnd(16)} ${r.title.slice(0, 50)}`);
  if (!APPLY) { console.log('dry run: nothing written'); return; }
  const ids = picked.map((r) => r.book_id);
  // The filter re-asserts the state the census saw: still flagged, still not split.
  const r = await db.collection('books').updateMany({ id: { $in: ids }, needs_splitting: true, split_completed: { $ne: true } }, { $set: { needs_splitting: false, split_note: NOTE } });
  const changed = await db.collection('books').find({ id: { $in: ids }, split_note: NOTE }, { projection: { id: 1 } }).toArray();
  await recordSweepActions(db, changed.map((b) => ({ sweep: SWEEP, book_id: b.id, action: 'unflagged-needs-splitting', detail: { verdict: 'single', samples: rows.find((x) => x.book_id === b.id)?.samples } })));
  console.log(`unflagged ${r.modifiedCount} of ${ids.length}; ${changed.length} sweep_log rows`);
});
