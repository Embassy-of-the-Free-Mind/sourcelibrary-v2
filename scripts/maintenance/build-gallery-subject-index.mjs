#!/usr/bin/env node
/**
 * PRIOR ART: `scripts/compute-iconclass-tree.mjs` precomputes the SAME page's other
 * axis (`system_config.iconclass_tree`) in the same shape — aggregate, pick a
 * representative thumbnail, write one config doc the ISR page reads. This is that
 * script pointed at `metadata.subjects` instead, because Iconclass reaches 1.2% of the
 * pictures and subjects reach 97.2% (measured below, 2026-09-16). Not merged into it:
 * that one owns a fixed 10-division tree with a curated sub-category map; this one has
 * no taxonomy at all, only what the descriptions actually say.
 *
 * Build the picture-subject index — the front door #4856 asked for.
 *
 * WHY (#4856)
 * -----------
 * Derek, on /browse/subjects/2-nature: "Iconclass is not helping the organization of
 * images." Measured on 190,169 visible gallery images:
 *
 *   metadata.iconclass    2,210  (1.2%)   ← what the browse tree indexes
 *   metadata.subjects   184,764 (97.2%)   ← what the model wrote about each picture
 *   metadata.technique  184,750 (97.2%)
 *   metadata.style      155,606 (81.8%)
 *
 * So the whole "2 Nature" division is 1,044 images of 190,169: the wall is
 * undifferentiated because the axis indexes almost nothing, not because a visual
 * taxonomy is the wrong idea. The subject terms, by contrast, are what a reader would
 * say out loud — botany (27,493), geometry (23,931), mathematics (14,361), astronomy
 * (10,938), alchemy (8,482), medicinal plants (7,359), cartography (5,031).
 *
 * WHAT IT REFUSES TO INDEX
 * `metadata.symbols` is 63% populated and its head is `A, B, C, D, E…` — diagram
 * labels, the detector's own artifact rather than a subject anyone browses by. Single
 * letters and bare numbers are dropped here for the same reason, and a term must reach
 * MIN_COUNT before it earns a tile: a one-image "subject" is a caption, not a category.
 *
 * NEVER writes to `books` or `pages`; one `system_config` document.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/build-gallery-subject-index.mjs
 *   … --limit=N     keep only the top N terms (default 200)
 *   … --min-count=N floor for a term to appear (default 25)
 *   … --dry-run     print the head of the index, write nothing
 */
import { MongoClient } from 'mongodb';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DRY = process.argv.includes('--dry-run');
const LIMIT = Number(ARG('limit', '200'));
const MIN_COUNT = Number(ARG('min-count', '25'));
const DOC_ID = 'gallery_subject_index';

/** Junk that is a diagram label or a stray token, never a subject to browse by. */
function isJunkTerm(term) {
  const t = String(term || '').trim();
  if (t.length < 3) return true;                 // "A", "B", "ii"
  if (/^[\d\W_]+$/.test(t)) return true;          // "1543", "—"
  if (/^(fig|no|plate|page|tab)\.?\s*\d*$/i.test(t)) return true;
  return false;
}

/** Display form: the terms arrive lower-case from the extractor, mostly. */
function label(term) {
  return term.length <= 3 ? term.toUpperCase() : term[0].toUpperCase() + term.slice(1);
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const visible = await db.collection('gallery_images').countDocuments({ book_visible: true });
  console.log(`visible gallery images: ${visible}`);

  console.log('aggregating metadata.subjects …');
  const rows = await db.collection('gallery_images').aggregate([
    { $match: { book_visible: true, 'metadata.subjects': { $exists: true, $ne: [] } } },
    // Best images first, so `$first` picks a thumbnail worth showing on the tile.
    { $sort: { gallery_quality: -1 } },
    { $unwind: '$metadata.subjects' },
    {
      $group: {
        _id: '$metadata.subjects',
        count: { $sum: 1 },
        thumbnail: { $first: '$thumbnail_url' },
        extracted: { $first: '$extracted_url' },
        books: { $addToSet: '$book_id' },
      },
    },
    { $match: { count: { $gte: MIN_COUNT } } },
    { $project: { count: 1, thumbnail: 1, extracted: 1, book_count: { $size: '$books' } } },
    { $sort: { count: -1 } },
    { $limit: LIMIT },
  ], { maxTimeMS: 600000, allowDiskUse: true }).toArray();

  const terms = rows
    .filter((r) => !isJunkTerm(r._id))
    .map((r) => ({
      term: r._id,
      label: label(r._id),
      count: r.count,
      book_count: r.book_count,
      thumbnail: r.thumbnail || r.extracted || null,
      // The gallery already filters on this exact value (`/api/gallery?subject=`),
      // so the tile needs no new query path.
      href: `/gallery?subject=${encodeURIComponent(r._id)}`,
    }));

  console.log(`${rows.length} terms over the floor, ${terms.length} after the junk filter`);
  console.log(terms.slice(0, 25).map((t) => `${t.label} (${t.count} in ${t.book_count} books)`).join(', '));

  if (DRY) { console.log('\n(dry run — nothing written)'); await client.close(); return; }

  await db.collection('system_config').updateOne(
    { _id: DOC_ID },
    {
      $set: {
        terms,
        total_images: visible,
        indexed_images: terms.reduce((n, t) => n + t.count, 0),
        min_count: MIN_COUNT,
        updated_at: new Date(),
        source: 'scripts/maintenance/build-gallery-subject-index.mjs (#4856)',
      },
    },
    { upsert: true },
  );
  console.log(`wrote system_config.${DOC_ID}: ${terms.length} terms`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
