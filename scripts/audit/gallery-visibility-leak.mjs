#!/usr/bin/env node
/**
 * Standing detector: images from non-visible books reachable on public gallery surfaces.
 *
 * Two independent ways art from a hidden book keeps rendering after the hide:
 *
 *   1. `gallery_collections.image_ids` is a materialized snapshot, frozen when the
 *      thematic gallery was seeded. Hiding a book later does not prune it.
 *   2. `gallery_images.book_visible` is denormalised from `books.visible` and only
 *      refreshed when a book's PAGES change, so a bare visibility flip leaves it stale.
 *
 * Both fired for real: six weeks after the Kloss/CMC takedown (2026-07-08), 38 images
 * from removed books were still served on /collections/freemasonry and friends, and
 * 1,217 gallery rows still claimed book_visible:true for a hidden book.
 *
 * Exit 1 if anything leaks, 2 if the DB is unreachable (never silently "clean").
 *
 * Usage: node --env-file=.env.production.local scripts/audit/gallery-visibility-leak.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

let client;
try {
  client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 15000 });
  await client.connect();
} catch (err) {
  console.error(`Cannot reach Mongo: ${err.message}`);
  process.exit(2);
}

const db = client.db('bookstore');
const books = db.collection('books');
const gallery = db.collection('gallery_images');
const galleryCollections = db.collection('gallery_collections');

const hiddenIds = (await books.find({ visible: { $ne: true } }).project({ id: 1 }).toArray()).map(b => b.id);
const hidden = new Set(hiddenIds);

// ── 1. stale denormalised flag ──
const staleTrue = await gallery.countDocuments({ book_id: { $in: hiddenIds }, book_visible: true });

// ── 2. frozen thematic gallery lists ──
const cols = await galleryCollections.find({ type: 'thematic' })
  .project({ slug: 1, book_collection_slug: 1, image_ids: 1 }).toArray();

const leaking = [];
for (const col of cols) {
  const ids = col.image_ids || [];
  if (!ids.length) continue;
  const imgs = await gallery.find({ id: { $in: ids } }).project({ id: 1, book_id: 1 }).toArray();
  const bad = imgs.filter(i => hidden.has(i.book_id));
  if (bad.length) leaking.push({ slug: col.book_collection_slug || col.slug, count: bad.length, of: ids.length });
}

const totalFrozen = leaking.reduce((a, b) => a + b.count, 0);

console.log(`Non-visible books: ${hidden.size}`);
console.log(`gallery_images rows claiming book_visible:true for a hidden book: ${staleTrue}`);
console.log(`thematic gallery_collections scanned: ${cols.length}`);
console.log(`thematic galleries listing images from hidden books: ${leaking.length} (${totalFrozen} images)`);
for (const l of leaking.sort((a, b) => b.count - a.count)) {
  console.log(`  ${l.slug.padEnd(36)} ${l.count} of ${l.of}`);
}

// Reported, not enforced: the converse drift suppresses art that SHOULD show. Surfacing
// those is a curation decision (it publishes images), so this detector only counts them.
const visibleIds = (await books.find({ visible: true }).project({ id: 1 }).toArray()).map(b => b.id);
const staleFalse = await gallery.countDocuments({ book_id: { $in: visibleIds }, book_visible: false });
console.log(`\n(FYI, not a leak) rows claiming book_visible:false for a VISIBLE book: ${staleFalse}`);

await client.close();

if (staleTrue > 0 || totalFrozen > 0) {
  console.error('\nLEAK: art from non-visible books is reachable. Prune image_ids and re-sync book_visible.');
  process.exit(1);
}
console.log('\nClean.');
