#!/usr/bin/env node
/**
 * Go-live for the June 2026 CADAL Chinese acquisition (issue #4311).
 * Publishes the hidden CADAL fascicle volumes as browsable facsimiles:
 * full page images on R2, partial (sample) OCR, work-clustered via Kanripo ids.
 *
 * Scoped to the CADAL-from-IA batch only (ia_identifier like "NNNNNNNN.cn") —
 * other hidden Chinese books are NOT flipped here; they need their own audit.
 *
 * Idempotent; only flips books whose pages are >=95% archived to R2.
 * Respects deliberate holds: any hidden_reason means the book is skipped
 * (never bulk-unhide takedown/copyright holds — Kloss lesson).
 *
 * Steps (per lesson_unhide_book_needs_supabase_and_isr):
 *   1. books: visible:true + hidden:false (the pair, always) + $unset hidden_reason
 *      + updated_at bump (Supabase sync keys off updated_at)
 *   2. AFTER this script:
 *        node scripts/workers/sync-books-catalog.mjs
 *        node scripts/maintenance/backfill-total-book-count.mjs --apply
 *        ISR revalidate + Cloudflare purge (this script prints the commands)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/golive-cadal-chinese-2026-08.mjs --dry-run
 *   node scripts/maintenance/golive-cadal-chinese-2026-08.mjs --pilot   # in-collection + fully-OCR'd books only
 *   node scripts/maintenance/golive-cadal-chinese-2026-08.mjs --full    # everything passing the gate
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const PILOT = process.argv.includes('--pilot');
const FULL = process.argv.includes('--full');
if (!DRY && !PILOT && !FULL) {
  console.error('Pass one of --dry-run | --pilot | --full');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Tri-state visible: {$ne: true} means "not public" (never {visible: false}).
const candidates = await db.collection('books').find(
  {
    language: 'Chinese',
    visible: { $ne: true },
    ia_identifier: { $regex: /^\d+\.cn$/ },
    pages_count: { $gt: 0 },
  },
  { projection: { id: 1, title: 1, pages_count: 1, pages_ocr: 1, hidden_reason: 1, collections: 1 } },
).toArray();

const holds = candidates.filter(b => b.hidden_reason);
const pool = candidates.filter(b => !b.hidden_reason);
console.log(`CADAL hidden candidates: ${candidates.length}; deliberate holds skipped: ${holds.length}`);
for (const h of holds) console.log(`  hold: ${h.title?.slice(0, 60)} [${h.hidden_reason}]`);

// Archive completeness from the pages collection itself (denormalized
// counters can drift) — one aggregation per 1,000-book chunk.
const archived = new Map(); // book_id -> {total, archived}
for (let i = 0; i < pool.length; i += 1000) {
  const ids = pool.slice(i, i + 1000).map(b => b.id);
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids } } },
    { $group: {
      _id: '$book_id',
      total: { $sum: 1 },
      archived: { $sum: { $cond: [
        { $or: [
          { $gt: ['$archived_photo', null] },
          { $gt: ['$display_photo', null] },
        ] }, 1, 0 ] } },
    } },
  ], { allowDiskUse: true }).toArray();
  for (const r of rows) archived.set(r._id, r);
  process.stdout.write(`  archive check ${Math.min(i + 1000, pool.length)}/${pool.length}\r`);
}
console.log('');

const ready = [];
const notReady = [];
for (const b of pool) {
  const a = archived.get(b.id);
  if (a && a.total > 0 && a.archived >= a.total * 0.95) ready.push(b);
  else notReady.push(`${b.title?.slice(0, 50)} (${a ? `${a.archived}/${a.total}` : 'no pages'})`);
}

const inCollections = ready.filter(b => (b.collections || []).length > 0);
const fullyOcrd = ready.filter(b => b.pages_ocr >= 0.99 * b.pages_count);
const pilotSet = [...new Map([...inCollections, ...fullyOcrd].map(b => [b.id, b])).values()];
const wave = PILOT ? pilotSet : ready;

console.log(`gate passed: ${ready.length}; failed archive gate: ${notReady.length}`);
console.log(`pilot set (in-collection ∪ fully-OCR'd): ${pilotSet.length}`);
console.log(`this run (${PILOT ? 'pilot' : FULL ? 'full' : 'dry-run'}) would flip: ${DRY ? 0 : wave.length} of ${wave.length}`);
for (const n of notReady.slice(0, 20)) console.log('  wait:', n);
if (notReady.length > 20) console.log(`  … and ${notReady.length - 20} more`);

if (!DRY && wave.length) {
  const now = new Date();
  let flipped = 0;
  for (let i = 0; i < wave.length; i += 1000) {
    const ids = wave.slice(i, i + 1000).map(b => b.id);
    const r = await db.collection('books').updateMany(
      { id: { $in: ids }, visible: { $ne: true } },
      { $set: { visible: true, hidden: false, updated_at: now }, $unset: { hidden_reason: '' } },
    );
    flipped += r.modifiedCount;
  }
  console.log('books flipped:', flipped);
}

await client.close();
console.log(DRY ? 'dry-run complete' : `done. NOW RUN:
  node scripts/workers/sync-books-catalog.mjs
  node scripts/maintenance/backfill-total-book-count.mjs --apply
  curl -s -X POST https://sourcelibrary.org/api/admin/revalidate -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" --data '{"collections": true, "paths": ["/collections", "/", "/explore"]}'
  + Cloudflare purge (see .claude/docs/invariants/deploy-and-caching.md)`);
