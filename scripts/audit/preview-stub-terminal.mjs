#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/status-output-drift.mjs. It asks "does the status claim
 * output that is ABSENT", and a 25-page preview is present, so every stub passes it.
 * scripts/maintenance/reocr-launch-books.mjs is the repair sweep (unscoped, writes),
 * not a detector. Neither answers "are stubs still being WRITTEN?" (#4719).
 *
 * Preview stubs at a post-OCR status: books whose only OCR is the 25-page Phase 1.5
 * sample, sitting at a status that claims the book has been through OCR.
 *
 * The shape is the one measured in #4719: text book, `pages_count > 60`,
 * `1 <= pages_ocr <= 30`. Every book of that shape is below the requeue bar in
 * `scripts/lib/preview-stub-guard.mjs` (<= 30/61 < 50%). So a book that ENTERED a
 * post-OCR status in the last 24 h was written by a writer the guard does not sit
 * in front of. That is the alarm, and it exits 1.
 *
 * The standing backlog (~13K `complete`) is reported but does not fail the run.
 * Re-entering it is a spend decision waiting on Derek (#4719, the DECISIONS-PENDING
 * row), not a defect for this detector to page about.
 *
 * Read-only.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/preview-stub-terminal.mjs
 *   node --env-file=.env.production.local scripts/audit/preview-stub-terminal.mjs --samples
 *   ... --hours 48     window for "new" (default 24)
 */
import { MongoClient } from 'mongodb';
import { POST_OCR_STATUSES } from '../lib/preview-stub-guard.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const SAMPLES = process.argv.includes('--samples');
const HOURS = Number(arg('--hours', 24));
const since = new Date(Date.now() - HOURS * 3600 * 1000);

/** The #4719 stub shape. Artwork records (resource_type set) have no pages to OCR. */
const STUB = { resource_type: { $exists: false }, pages_count: { $gt: 60 }, pages_ocr: { $gte: 1, $lte: 30 } };
const POST_OCR = { 'pipeline_auto.status': { $in: POST_OCR_STATUSES } };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const B = db.collection('books');

const rows = await B.aggregate([
  { $match: { ...STUB, ...POST_OCR } },
  { $group: {
    _id: { status: '$pipeline_auto.status', visible: { $eq: ['$visible', true] } },
    books: { $sum: 1 },
    untranscribed: { $sum: { $subtract: ['$pages_count', '$pages_ocr'] } },
    fresh: { $sum: { $cond: [{ $gte: ['$pipeline_auto.last_updated', since] }, 1, 0] } },
  } },
  { $sort: { books: -1 } },
], { allowDiskUse: true }).toArray();

let total = 0, fresh = 0, pages = 0;
console.log(`PREVIEW STUBS AT A POST-OCR STATUS (pages_count > 60, pages_ocr 1–30)\n`);
console.log(`${'status'.padEnd(20)} ${'visible'.padEnd(8)} ${'books'.padStart(7)} ${'untranscribed pp'.padStart(17)} ${`new ${HOURS}h`.padStart(8)}`);
for (const r of rows) {
  total += r.books; fresh += r.fresh; pages += r.untranscribed;
  console.log(`${r._id.status.padEnd(20)} ${(r._id.visible ? 'yes' : 'no').padEnd(8)} ${String(r.books).padStart(7)} ${String(r.untranscribed).padStart(17)} ${String(r.fresh).padStart(8)}`);
}
console.log(`${'TOTAL'.padEnd(29)} ${String(total).padStart(7)} ${String(pages).padStart(17)} ${String(fresh).padStart(8)}`);

// The guard's own record: refusals in the window, by writer and outcome.
const refusals = await db.collection('audit_log').aggregate([
  { $match: { action: 'pipeline_status_preview_stub', timestamp: { $gte: since } } },
  { $group: { _id: { source: '$metadata.source', to: '$metadata.redirected_to', enforced: '$metadata.enforced' }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();
console.log(`\nguard refusals in the last ${HOURS}h: ${refusals.reduce((a, r) => a + r.n, 0)}`);
for (const r of refusals) console.log(`  ${String(r.n).padStart(6)}  ${r._id.source} → ${r._id.to}${r._id.enforced ? '' : ' (observe)'}`);

if (SAMPLES && fresh > 0) {
  console.log(`\nsamples written in the last ${HOURS}h:`);
  const s = await B.find({ ...STUB, ...POST_OCR, 'pipeline_auto.last_updated': { $gte: since } })
    .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, visible: 1, 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1 })
    .limit(10).toArray();
  for (const b of s) {
    console.log(`  ${b.id} ${b.visible ? 'PUB' : 'hid'} ${b.pipeline_auto.status} ${b.pages_ocr}/${b.pages_count}pp ${b.pipeline_auto.last_updated?.toISOString()} ${String(b.title).slice(0, 40)}`);
  }
}

await client.close();

if (fresh > 0) {
  console.log(`\nFAIL: ${fresh} preview stub(s) entered a post-OCR status in the last ${HOURS}h — a writer is not behind the guard.`);
  process.exit(1);
}
console.log(`\nOK: no preview stub entered a post-OCR status in the last ${HOURS}h.`);
