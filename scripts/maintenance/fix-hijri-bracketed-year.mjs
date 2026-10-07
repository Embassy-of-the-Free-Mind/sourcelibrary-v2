#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/quality-sprint-classes.mjs `hijri` (the detector; this repairs its one
 * certain class). scripts/audit/ia-date-check.mjs judges IA candidate dates before import and writes
 * nothing to Mongo. No existing writer converted a stored Hijri year.
 *
 * fix-hijri-bracketed-year — set `books.year` to the CE year where the catalogue already gives it (#6056).
 *
 * WHY. Leiden's Arabic and Malay manuscripts arrive with `published` like "1303 [1885]": the Hijri year,
 * then the CE year in brackets. The importer took the first number, so `year` says 1303 and the reader,
 * the date filters and every period count place an 1885 manuscript in the 14th century. The CE year is in
 * the record already; nothing is inferred. Only books whose `published` carries a bracketed CE year AND whose
 * `year` equals the first (Hijri) number are touched, and the Hijri→CE pair must agree to ±2 years under
 * CE ≈ AH × 0.970229 + 621.5643, so a bracket holding something else ("[before 1892]" on a 1309 AH book is
 * kept — it agrees) cannot slip through.
 *
 * Reversible: the old year goes into a sweep_log row (sweep `hijri-bracketed-year-6056`).
 *
 *   node --env-file=.env.production.local scripts/maintenance/fix-hijri-bracketed-year.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/fix-hijri-bracketed-year.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'hijri-bracketed-year-6056';
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');

const cands = await books.find({ published: /\b1[0-4]\d{2}\s*\[[^\]]*\b1[6-9]\d{2}/ }, { projection: { _id: 0, id: 1, title: 1, year: 1, published: 1, visible: 1 } }).toArray();
let n = 0, skipped = 0;
for (const b of cands) {
  const ah = Number(b.published.match(/\b(1[0-4]\d{2})\s*\[/)[1]);
  const ce = Number(b.published.match(/\[[^\]]*\b(1[6-9]\d{2})/)[1]);
  const expected = ah * 0.970229 + 621.5643;
  if (b.year !== ah || Math.abs(ce - expected) > 2) { skipped++; console.log(`skip ${b.id} year=${b.year} published="${b.published}" (AH ${ah} → ${expected.toFixed(0)} CE)`); continue; }
  console.log(`${b.id} ${b.visible ? 'public' : 'hidden'} year ${b.year} → ${ce}  "${b.published}"  ${String(b.title).slice(0, 50)}`);
  n++;
  if (!APPLY) continue;
  const r = await books.updateOne({ id: b.id, year: ah }, { $set: { year: ce, updated_at: new Date() } });
  if (r.modifiedCount === 1) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'year-hijri-to-ce', detail: { from: ah, to: ce, published: b.published, issue: 6056 } });
}
console.log(`${APPLY ? 'fixed' : '[DRY RUN] would fix'} ${n} · skipped ${skipped} · candidates ${cands.length}`);
await client.close();
