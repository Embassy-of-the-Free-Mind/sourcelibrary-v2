#!/usr/bin/env node
/**
 * Repair the e-rara off-by-one image/text misalignment (#3186, 2026-07-25).
 *
 * The resolution sweep re-fetched e-rara pages from photo_original (IIIF canvas
 * list), but the ORIGINAL import had archived e-rara's generated cover sheet as
 * page 1 — so every image moved one page left under its OCR/translation. The
 * census (scripts/output/erara-shift-census-2026-07-25.json) confirmed verdict
 * "shifted+1": image(pN) matches OCR(p(N+1)).
 *
 * Repair per confirmed book: move the TEXT fields (ocr, translation,
 * translation_summary, translation_keywords, page_type, columns) from p(N+1)
 * to p(N) for N = 1..last-1; clear them on the last page (its text was never
 * produced — flagged for targeted re-OCR). Every replaced value is snapshotted
 * to page_revisions first (source: 'shift-repair-erara-2026-07'), and each book
 * gets a book_events record — fully reversible.
 *
 * Guards: only census verdict "shifted+1"; books containing split pages are
 * skipped + flagged for manual repair; idempotent via book_events (a book with
 * an existing text_shift_repair event is skipped).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-erara-text-shift.mjs --limit 5 [--apply]
 *   node scripts/maintenance/repair-erara-text-shift.mjs --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { nanoid } from 'nanoid';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 ? parseInt(process.argv[i + 1]) : 0; })();
const CENSUS = '/Users/dereklomas/sourcelibrary/scripts/output/erara-shift-census-2026-07-25.json';
const SHIFT_FIELDS = ['ocr', 'translation', 'translation_summary', 'translation_keywords', 'page_type', 'columns'];

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
let targets = census.filter((r) => r.verdict === 'shifted+1');
if (LIMIT) targets = targets.slice(0, LIMIT);
console.log(`${targets.length} shifted books targeted${APPLY ? '' : ' (DRY RUN)'}`);

let repaired = 0, skippedSplit = 0, skippedDone = 0, errors = 0;
for (const t of targets) {
  try {
    const already = await db.collection('book_events').findOne({ book_id: t.id, type: 'text_shift_repair' }, { projection: { _id: 1 } });
    if (already) { skippedDone++; continue; }

    const pages = await db.collection('pages').find({ book_id: t.id }).sort({ page_number: 1 }).toArray();
    if (pages.some((p) => p.split_side)) {
      skippedSplit++;
      if (APPLY) await db.collection('books').updateOne({ id: t.id }, { $set: { text_shift_repair_manual: true } });
      console.log(`  SKIP split-pages: ${t.title}`);
      continue;
    }

    if (!APPLY) { repaired++; continue; }

    const now = new Date();
    // Snapshot everything we will overwrite, then write shifted values from the
    // in-memory copy (no ordering hazard).
    const revisions = [];
    const bulk = [];
    for (let n = 0; n < pages.length; n++) {
      const dst = pages[n];
      const src = pages[n + 1] ?? null; // last page: clear
      for (const f of ['ocr', 'translation']) {
        if (dst[f]?.data) {
          revisions.push({
            id: nanoid(12), page_id: dst.id, book_id: t.id, field: f,
            data: dst[f].data, model: dst[f].model ?? null, language: dst[f].language ?? null,
            prompt_version: dst[f].prompt_version ?? null, source: 'shift-repair-erara-2026-07',
            edited_by: null, job_id: null, original_date: dst[f].updated_at ?? null, created_at: now,
          });
        }
      }
      const set = {}; const unset = {};
      for (const f of SHIFT_FIELDS) {
        if (src && src[f] !== undefined) set[f] = src[f];
        else unset[f] = '';
      }
      set.updated_at = now;
      set.text_shift_repaired_at = now;
      const op = { updateOne: { filter: { _id: dst._id }, update: { $set: set } } };
      if (Object.keys(unset).length) op.updateOne.update.$unset = unset;
      bulk.push(op);
    }

    if (revisions.length) await db.collection('page_revisions').insertMany(revisions);
    if (bulk.length) await db.collection('pages').bulkWrite(bulk);

    const pagesOcr = await db.collection('pages').countDocuments({ book_id: t.id, 'ocr.data': { $exists: true, $ne: '' } });
    const pagesTr = await db.collection('pages').countDocuments({ book_id: t.id, 'translation.data': { $exists: true, $ne: '' } });
    await db.collection('books').updateOne(
      { id: t.id },
      { $set: {
        pages_ocr: pagesOcr, pages_translated: pagesTr, updated_at: now,
        'reocr_candidate.last_page_cleared': true,
      } },
    );
    await db.collection('book_events').insertOne({
      book_id: t.id, type: 'text_shift_repair', at: now, source: 'repair-erara-text-shift',
      details: { shift: 'text p(N+1)->p(N)', pages: pages.length, revisions: revisions.length, census_probe_page: t.probe_page, reason: 'erara cover-sheet off-by-one (#3186)' },
    });
    repaired++;
    if (repaired % 25 === 0) console.log(`  ${repaired} repaired...`);
  } catch (e) {
    errors++;
    console.error(`  ERR ${t.id}: ${e.message?.slice(0, 100)}`);
  }
}
console.log(`\nDone. repaired: ${repaired}, skipped-split: ${skippedSplit}, already-done: ${skippedDone}, errors: ${errors}`);
await mongo.close();
