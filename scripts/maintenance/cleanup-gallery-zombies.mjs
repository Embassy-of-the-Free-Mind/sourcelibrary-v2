#!/usr/bin/env node
/**
 * Hide zombie gallery_images rows — rows the batch-collector / image-extract-worker
 * wrote without filtering, when Gemini returned malformed responses (no bbox,
 * no gallery_quality, no description). Active code paths now filter these out
 * (see PR that landed alongside this script); this is a one-shot cleanup for
 * the historical residue.
 *
 * Conservative: marks rows as `is_duplicate: true, book_visible: false`
 * with `dedup_reason: "zombie_no_metadata"` — does NOT delete. Mirrors the
 * pattern in scripts/dedup-gallery-within-book.mjs so views drop them but the
 * docs remain for rollback.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/cleanup-gallery-zombies.mjs --dry-run
 *   node scripts/maintenance/cleanup-gallery-zombies.mjs --apply
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const gallery = db.collection('gallery_images');

// Zombie definition: no bbox AND (no description OR empty description) AND (no image_url OR empty image_url)
// (matches what we saw on disk: bbox:null, description:"", gallery_quality:null)
const FILTER = {
  $and: [
    { $or: [{ bbox: null }, { bbox: { $exists: false } }] },
    { $or: [{ description: { $exists: false } }, { description: '' }, { description: null }] },
    { $or: [{ image_url: { $exists: false } }, { image_url: '' }, { image_url: null }] },
    // Don't re-process if already hidden by a prior dedup pass
    { is_duplicate: { $ne: true } },
  ],
};

const total = await gallery.countDocuments(FILTER);
console.log(`Zombie rows eligible for hiding: ${total.toLocaleString()}${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

if (total === 0) {
  await c.close();
  process.exit(0);
}

// Breakdown by book to gauge spread
const byBook = await gallery.aggregate([
  { $match: FILTER },
  { $group: { _id: '$book_id', n: { $sum: 1 } } },
  { $count: 'bookCount' },
]).toArray();
console.log(`Affecting ${byBook[0]?.bookCount?.toLocaleString() || 0} distinct books`);

// Breakdown by recency
const recent = await gallery.countDocuments({ ...FILTER, detected_at: { $gte: new Date(Date.now() - 7*86400000) } });
console.log(`Of those, ${recent.toLocaleString()} written in the last 7 days (current bug — should drop to 0 after worker patch lands)`);

if (DRY_RUN) {
  console.log('\nSample 3 docs:');
  const samples = await gallery.find(FILTER).limit(3).toArray();
  for (const s of samples) {
    console.log(`  ${s.id}  book=${s.book_id}  detected_at=${s.detected_at?.toISOString?.()}  model=${s.model}`);
  }
  console.log('\nRe-run with --apply to mark these rows is_duplicate=true, book_visible=false.');
  await c.close();
  process.exit(0);
}

console.log('\nApplying...');
const startedAt = Date.now();
const r = await gallery.updateMany(FILTER, {
  $set: {
    is_duplicate: true,
    book_visible: false,
    dedup_hidden_at: new Date(),
    dedup_reason: 'zombie_no_metadata',
    updated_at: new Date(),
  },
});
console.log(`Hidden ${r.modifiedCount.toLocaleString()} rows in ${((Date.now() - startedAt)/1000).toFixed(1)}s`);

await c.close();
