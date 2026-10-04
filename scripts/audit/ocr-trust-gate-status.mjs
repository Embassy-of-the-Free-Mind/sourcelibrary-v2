#!/usr/bin/env node
/**
 * The OCR trust gate's counter (#5700 working rule 3: a shipped gate ships with a counter, and its
 * first refusals are checked by eye). Read-only.
 *
 * PRIOR ART: scripts/audit/pipeline-hold-drift.mjs — reconciles per-book HOLDS (marker vs status);
 * the trust gate holds no book, it refuses at enrol, so there is no marker to reconcile.
 * scripts/eval/ocr-trust-gate-census.mjs sizes the strata (what COULD be refused); this counts what
 * WAS: `book_events` rows of type `ocr_trust_refusal` (one per book × stratum, written by
 * recordOcrTrustRefusal), chained runs parked for the gate, and books the gate has released.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/ocr-trust-gate-status.mjs [--list=20]
 */
import { MongoClient } from 'mongodb';
import { OCR_TRUST_TABLE, REFUSAL_EVENT, ocrTrustVerdictForBook } from '../lib/ocr-trust-gate.mjs';
import { RUNS_COLLECTION } from '../lib/translate-batch-seam.mjs';

const LIST = Number(process.argv.find((a) => a.startsWith('--list='))?.split('=')[1] || 20);
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const events = await db.collection('book_events').find({ type: REFUSAL_EVENT }).sort({ at: 1 }).toArray();
const parked = await db.collection(RUNS_COLLECTION).find({ parked_for_ocr_trust: { $exists: true } }, { projection: { _id: 0, id: 1, book_id: 1, parked_for_ocr_trust: 1, counts: 1, page_count: 1 } }).toArray();

console.log(`OCR trust gate — ${events.length} book(s) refused, ${parked.length} chained run(s) parked`);
for (const row of OCR_TRUST_TABLE) {
  const mine = events.filter((e) => e.details?.stratum === row.id);
  let released = 0;
  for (const e of mine) {
    const book = await db.collection('books').findOne({ id: e.book_id }, { projection: { _id: 0, id: 1, language: 1, year: 1, published: 1 } });
    if (book && (await ocrTrustVerdictForBook(db, book)).released) released += 1;
  }
  const refusals = mine.reduce((s, e) => s + (e.details?.refusals || 0), 0);
  const lanes = [...new Set(mine.flatMap((e) => e.details?.lanes || []))];
  console.log(`  ${row.id.padEnd(24)} ${row.gated ? 'GATED ' : 'listed'}  books refused ${String(mine.length).padStart(4)}  refusals ${String(refusals).padStart(5)}  released since ${String(released).padStart(3)}  parked runs ${parked.filter((r) => r.parked_for_ocr_trust === row.id).length}  lanes: ${lanes.join(', ') || '—'}`);
}
if (LIST && events.length) {
  console.log(`\nFirst ${Math.min(LIST, events.length)} refusals (open the page images before trusting the gate):`);
  for (const e of events.slice(0, LIST)) console.log(`  ${new Date(e.at).toISOString().slice(0, 16)}  ${String(e.details?.stratum).padEnd(22)} https://sourcelibrary.org/book/${e.book_id}  ${e.details?.language ?? ''} ${e.details?.year ?? ''}  via ${e.details?.last_lane}`);
}
await client.close();
