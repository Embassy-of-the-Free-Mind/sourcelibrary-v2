#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/unflag-single-frames-7605.mjs — the opposite direction from the same census (clears
// the flag on single-page books); scripts/split-book.mjs sets the flag only on the one book it is run on. Nothing set
// needs_splitting from a census of unflagged books.
/**
 * Set `needs_splitting` on unflagged books whose frames are two-page spreads and that have no OCR yet (#7605).
 *
 * The aspect-ratio screen picked 1,199 unflagged books shaped like spreads; spread-confirm.mjs asked agy Flash low
 * about three pages of each (2026-10-29): 782 `multi`. This flags only those with no OCR (`ocr_pages: 0`), so the
 * split-before-read guard (pipeline-hold.mjs UNSPLIT_SPREAD) keeps them out of OCR and translation until they are
 * split. Books that already carry OCR are NOT flagged here: flagging them freezes lanes on books readers already read,
 * and what to do with their text is a separate decision on #7605.
 *
 * ACTUATION: the flag removes the book from every OCR/translation lane at its next cycle. Nothing is deleted.
 *
 *   node --env-file=.env.production.local scripts/maintenance/flag-spread-books-7605.mjs --census FILE [--apply]
 *   node --env-file=.env.production.local scripts/maintenance/flag-spread-books-7605.mjs --revert [--apply]
 * Dry run unless --apply. Each change writes a sweep_log row (sweep 'flag-spread-books-7605'); --revert clears the
 * flag on exactly those books.
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const CENSUS = arg('--census', null);
const SWEEP = 'flag-spread-books-7605';
const NOTE = '#7605 spread-confirm: every sampled frame two pages (agy gemini-3.8-flash-low, 2026-10-29)';

await withMongo(async (db) => {
  if (REVERT) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'flagged-needs-splitting' }).toArray();
    const ids = [...new Set(rows.map((r) => r.book_id))];
    console.log(`${ids.length} books to unflag${APPLY ? '' : ' (dry run)'}`);
    if (!APPLY) return;
    const r = await db.collection('books').updateMany({ id: { $in: ids }, needs_splitting: true, split_completed: { $ne: true }, split_note: NOTE }, { $set: { needs_splitting: false }, $unset: { split_note: '' } });
    await recordSweepActions(db, ids.map((book_id) => ({ sweep: SWEEP, book_id, action: 'reverted' })));
    console.log(`unflagged ${r.modifiedCount}`);
    return;
  }
  if (!CENSUS) { console.error('--census FILE is required'); process.exit(2); }
  const rows = fs.readFileSync(CENSUS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const picked = rows.filter((r) => r.verdict === 'multi' && r.ocr_pages === 0);
  console.log(`census: ${rows.length} books, ${rows.filter((r) => r.verdict === 'multi').length} multi, ${picked.length} with no OCR`);
  for (const r of picked) console.log(`  ${r.book_id}  ${String(r.language).padEnd(12)} ${String(r.status).padEnd(16)} ${String(r.title).slice(0, 50)}`);
  if (!APPLY) { console.log('dry run: nothing written'); return; }
  const ids = picked.map((r) => r.book_id);
  // The filter re-asserts the state the census saw: not flagged, not split, still no OCR on any page.
  const withOcr = new Set(await db.collection('pages').distinct('book_id', { book_id: { $in: ids }, 'ocr.data': { $type: 'string', $ne: '' } }));
  const go = ids.filter((id) => !withOcr.has(id));
  const r = await db.collection('books').updateMany({ id: { $in: go }, needs_splitting: { $ne: true }, split_completed: { $ne: true } }, { $set: { needs_splitting: true, split_note: NOTE } });
  const changed = await db.collection('books').find({ id: { $in: go }, split_note: NOTE }, { projection: { id: 1 } }).toArray();
  await recordSweepActions(db, changed.map((b) => ({ sweep: SWEEP, book_id: b.id, action: 'flagged-needs-splitting', detail: { verdict: 'multi', samples: rows.find((x) => x.book_id === b.id)?.samples } })));
  console.log(`flagged ${r.modifiedCount} of ${ids.length} (${withOcr.size} gained OCR since the census: skipped); ${changed.length} sweep_log rows`);
});
