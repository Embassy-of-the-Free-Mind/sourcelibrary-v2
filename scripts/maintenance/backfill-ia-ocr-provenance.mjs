#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs writes `ocr.ia` on every page it fills from
 * 2026-09-12 on; the 66,322 pages written before that carry only `ocr.model: 'ia-ocr/<ver>'`
 * and `ocr.source_url`. Nothing else backfills OCR provenance (backfill-ocr-warning-flags.mjs
 * is about the #4149 ink guard).
 *
 * backfill-ia-ocr-provenance — give every `ocr.source: 'ia_djvu'` page that lacks `ocr.ia`
 * the same provenance block the ingester now writes: the Archive item, its OCR engine and
 * module version, the date the text was generated (the `_djvu.xml` mtime), scan date and
 * contributor. One metadata request per BOOK, one updateMany per book, sweep_log row per book.
 *
 * 2026-10-23 (#4763): also fills `ocr.ia.licence` (iaTextLicence) on pages that already carry
 * `ocr.ia` but were written before the ingester recorded rights — the 97,059 pages of that day's
 * English run among them. Only the licence key is set on those; the rest of their block is kept.
 *
 * Usage (dry run by default; runs on Hetzner — the laptop is blocked from archive.org):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-ia-ocr-provenance.mjs            # count + plan
 *   node scripts/maintenance/backfill-ia-ocr-provenance.mjs --apply
 *   Options: --limit N  --book <id>
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { iaOcrMeta, iaProvenance, iaTextLicence } from '../lib/ia-ocr-meta.mjs';
import { publicationYear } from '../lib/ia-ocr-cohort.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const LIMIT = +arg('--limit', 100000);
const BOOK = arg('--book', null);

await withMongo(async (db) => {
  const P = db.collection('pages'), B = db.collection('books');
  // Drive from book_events, not from a scan of `pages` — `ocr.source` is unindexed and a
  // corpus-wide match times out; the ingester wrote one 'ia_ocr_ingest' event per book.
  const evMatch = { type: 'ia_ocr_ingest' }; if (BOOK) evMatch.book_id = BOOK;
  const bookIds = await db.collection('book_events').distinct('book_id', evMatch);
  const perBook = [];
  for (const bid of bookIds.slice(0, LIMIT)) {
    const noBlock = await P.countDocuments({ book_id: bid, 'ocr.source': 'ia_djvu', 'ocr.ia': { $exists: false } });
    const noLicence = await P.countDocuments({ book_id: bid, 'ocr.source': 'ia_djvu', 'ocr.ia': { $exists: true }, 'ocr.ia.licence': { $exists: false } });
    if (noBlock || noLicence) perBook.push({ _id: bid, noBlock, noLicence });
  }
  const sum = (k) => perBook.reduce((s, b) => s + b[k], 0);
  console.log(`${perBook.length} of ${bookIds.length} ingested books need work: ${sum('noBlock')} pages lack ocr.ia, ${sum('noLicence')} lack ocr.ia.licence — ${APPLY ? 'APPLY' : 'dry run'}`);
  let books = 0, pages = 0, missingMeta = 0; const byStatus = {};
  for (const { _id: bid, noBlock, noLicence } of perBook) {
    const b = await B.findOne({ id: bid }, { projection: { ia_identifier: 1, image_source: 1, title: 1, year: 1, published: 1 } });
    const iaId = b?.ia_identifier || b?.image_source?.identifier;
    if (!iaId) { console.log(`  ${bid} no IA identifier — skip`); continue; }
    const meta = await iaOcrMeta(iaId);
    if (!meta.has_djvu_xml && !meta.version) { missingMeta++; console.log(`  ${bid} ${iaId}: metadata unavailable — skip`); continue; }
    const year = publicationYear(b);
    const ia = iaProvenance(iaId, meta, { year });
    const licence = iaTextLicence(meta, year);
    byStatus[licence.status] = (byStatus[licence.status] || 0) + noBlock + noLicence;
    if (!APPLY) { console.log(`  ${bid} ${iaId}: ${noBlock} block + ${noLicence} licence ← ${ia.engine || '?'} ${ia.module_version || ''} | ${licence.status} (${year ?? 'no year'})`); books++; pages += noBlock + noLicence; continue; }
    const r1 = noBlock ? await P.updateMany({ book_id: bid, 'ocr.source': 'ia_djvu', 'ocr.ia': { $exists: false } }, { $set: { 'ocr.ia': ia } }) : { modifiedCount: 0 };
    const r2 = noLicence ? await P.updateMany({ book_id: bid, 'ocr.source': 'ia_djvu', 'ocr.ia': { $exists: true }, 'ocr.ia.licence': { $exists: false } }, { $set: { 'ocr.ia.licence': licence } }) : { modifiedCount: 0 };
    await recordSweepAction(db, { sweep: 'backfill-ia-ocr-provenance', book_id: bid, action: noBlock ? 'set_ocr_ia' : 'set_ocr_ia_licence', detail: { block_pages: r1.modifiedCount, licence_pages: r2.modifiedCount, engine: ia.engine, module_version: ia.module_version, licence: licence.status, publication_year: year } });
    books++; pages += r1.modifiedCount + r2.modifiedCount;
    if (r1.modifiedCount !== noBlock || r2.modifiedCount !== noLicence) console.log(`  ${bid}: expected ${noBlock}+${noLicence}, modified ${r1.modifiedCount}+${r2.modifiedCount}`);
  }
  console.log(JSON.stringify({ books, pages, missingMeta, byStatus, applied: APPLY }));
}, { timeoutMs: 4 * 60 * 60 * 1000 }); // one archive.org request per book at ≤ 2/s; the 5-min default killed the first run
