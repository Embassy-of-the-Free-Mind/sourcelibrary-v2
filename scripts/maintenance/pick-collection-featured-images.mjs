#!/usr/bin/env node
/**
 * Choose `featured_images` for a collection that has none — issue #4151.
 *
 * WHY: `en-espanol` is derived by sync-es-collection.mjs, which writes editorial
 * copy on insert and never touches images, so the flagship Spanish card on
 * /es/collections rendered an empty grey box while every hand-assigned
 * collection beside it had art. The enrichment assigners
 * (assign-collections.mjs et al.) populate this field, but they only run over
 * the collections they assign — a derived collection is never in their set.
 *
 * Ranks by `gallery_quality` AND `luminance` (backfill-gallery-luminance.mjs).
 * Quality alone is what put a mean-grey-59 Fludd engraving in a hero: a pristine
 * scan of a dark mezzotint scores 1.0 and renders as a hole. Candidates outside
 * a comfortable luminance band are dropped before ranking, and at most one image
 * per book is kept so a single well-illustrated title cannot supply the whole
 * card.
 *
 * Honours `featured_images_curated` — a human's picks are never overwritten.
 *
 *   node --env-file=.env.production.local scripts/maintenance/pick-collection-featured-images.mjs --collection=en-espanol [--apply]
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const strArg = (n) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split('=')[1] : null; };
const SLUG = strArg('collection');
const COUNT = Number(strArg('count') || 6);
if (!SLUG) { console.error('--collection=<slug> is required'); process.exit(1); }

// A hero tile wants a readable mid-to-light image. 95 excludes the black plates
// this exists to keep out; 240 excludes near-blank leaves, which read as holes
// just as badly at the other end.
const LUM_MIN = Number(strArg('lum-min') || 95);
const LUM_MAX = Number(strArg('lum-max') || 240);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
await client.connect();
const db = client.db('bookstore');

const col = await db.collection('collections').findOne({ slug: SLUG });
if (!col) { console.error(`no collection "${SLUG}"`); await client.close(); process.exit(1); }
if (col.featured_images_curated) {
  console.log(`"${SLUG}" is manually curated — refusing to overwrite.`);
  await client.close();
  process.exit(0);
}
console.log(`"${col.name}" — currently ${(col.featured_images || []).length} featured image(s), hero_image=${col.hero_image ? 'set' : 'none'}`);

const bookIds = (await db.collection('books')
  .find({ collections: SLUG, visible: true }, { projection: { id: 1 } }).toArray()).map((b) => b.id);

const candidates = await db.collection('gallery_images').find({
  book_id: { $in: bookIds },
  book_visible: true,
  gallery_quality: { $gte: 0.85 },
  luminance: { $gte: LUM_MIN, $lte: LUM_MAX },
  type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
}, {
  projection: {
    _id: 0, id: 1, page_id: 1, detection_index: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1,
    description: 1, type: 1, gallery_quality: 1, luminance: 1,
    book_id: 1, book_title: 1, book_author: 1, book_year: 1,
  },
}).sort({ gallery_quality: -1, luminance: -1 }).limit(400).toArray();

console.log(`${candidates.length} candidate(s) inside the luminance band ${LUM_MIN}–${LUM_MAX}`);

// One per book, so the card shows the breadth of the collection.
const picked = []; const seen = new Set();
for (const img of candidates) {
  if (seen.has(img.book_id)) continue;
  seen.add(img.book_id);
  picked.push(img);
  if (picked.length >= COUNT) break;
}

for (const p of picked) {
  console.log(`  q=${p.gallery_quality} lum=${String(p.luminance).padStart(3)} ${String(p.type).padEnd(12)} ${(p.book_title || '').slice(0, 44)}`);
}
if (!picked.length) { console.error('no candidates — widen the band or lower the quality floor'); await client.close(); process.exit(1); }

if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); await client.close(); process.exit(0); }

await db.collection('collections').updateOne(
  { slug: SLUG },
  { $set: { featured_images: picked, featured_images_updated: new Date(), updated_at: new Date() } },
);
console.log(`\nwrote ${picked.length} featured image(s) to "${SLUG}"`);
await client.close();
