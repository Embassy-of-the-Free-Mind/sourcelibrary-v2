#!/usr/bin/env node
/**
 * Run image extraction across the Slime Moulds collection.
 *
 * The paused pipeline orchestrator owns the good batch path, and the public
 * /api/extract-images endpoint random-samples up to 20 pages per call (so repeat
 * calls re-process pages). This uses /api/jobs/queue-books instead, which takes
 * explicit page ids — so we send exactly the candidate pages the orchestrator
 * would have chosen, and nothing else.
 *
 * Candidate selection mirrors pipeline-orchestrator.mjs: pages typed as
 * illustration/diagram/map/frontispiece/mixed/title-page, plus pages whose OCR
 * carries image markup, minus pages whose only markup is trivial (ornaments,
 * stamps, drop caps). Extraction is the priciest step per page, so sending the
 * whole book would multiply the bill for no gain.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/extract-slime-moulds-images.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET && !DRY) { console.error('CRON_SECRET not set.'); process.exit(1); }

const TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];
const SKIP = [
  { type: 'symbol', significance: '*' }, { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' }, { type: 'blank', significance: '*' },
  { type: 'exlibris', significance: '*' }, { type: 'bookplate', significance: '*' },
  { type: 'decorative', significance: 'low' }, { type: "printer's mark", significance: 'low' },
  { type: 'photograph', significance: 'low' }, { type: 'photographic', significance: 'low' },
];
// A book with plates already extracted is skipped: extraction is billed per
// page and re-running it pays twice for images already in the gallery.
const ALREADY_EXTRACTED = 5;
const RATE = 0.0035; // $/candidate page, from Micheli's logged $0.825 over 238

function skipByMarkup(ocr) {
  if (!ocr) return false;
  if (ocr.includes('<detected-images>')) return false;
  const tags = [...ocr.matchAll(/<image-desc([^>]*)>/g)];
  if (!tags.length) return false;
  for (const m of tags) {
    const type = (m[1].match(/type="([^"]+)"/) || [])[1];
    const sig = (m[1].match(/significance="([^"]+)"/) || [])[1];
    if (!SKIP.find(r => r.type === type && (r.significance === '*' || r.significance === sig))) return false;
  }
  return true;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const books = await db.collection('books')
  .find({ collections: 'slime-moulds' }, { projection: { _id: 0, id: 1, title: 1 } }).toArray();

let queued = 0, estimate = 0;
for (const b of books) {
  const existing = await db.collection('gallery_images').countDocuments({ book_id: b.id });
  const label = String(b.title).slice(0, 34).padEnd(36);
  if (existing >= ALREADY_EXTRACTED) { console.log(`${label} skip, ${existing} plates already extracted`); continue; }

  const raw = await db.collection('pages').find({
    book_id: b.id, page_number: { $gt: 0 },
    $or: [
      { page_type: { $in: TYPES } },
      { page_type: { $nin: TYPES }, 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
    ],
  }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } }).toArray();
  const ids = raw.filter(p => TYPES.includes(p.page_type) || !skipByMarkup(p.ocr?.data)).map(p => p.id);
  if (!ids.length) { console.log(`${label} no candidates`); continue; }

  const cost = ids.length * RATE;
  estimate += cost;
  if (DRY) { console.log(`${label} would queue ${String(ids.length).padStart(4)} pages  ~$${cost.toFixed(2)}`); continue; }

  const res = await fetch('https://sourcelibrary.org/api/jobs/queue-books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ bookId: b.id, pageIds: ids, action: 'image_extraction' }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`${label} queued ${String(ids.length).padStart(4)} pages  ~$${cost.toFixed(2)}  ${res.status} ${j.jobId || j.error || ''}`);
  if (res.ok) queued += ids.length;
  await new Promise(r => setTimeout(r, 1500));
}
console.log(`\n${DRY ? 'Would queue' : 'Queued'} ${queued} candidate pages, estimated $${estimate.toFixed(2)}.`);
await client.close();
