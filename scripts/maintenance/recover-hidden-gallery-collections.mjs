#!/usr/bin/env node
/**
 * Re-cover the gallery collections that backfill-gallery-collection-covers.mjs
 * hid (no resolvable cover). Investigation showed the images aren't gone — the
 * CDN files survive and the source books are still visible; the rows were moved
 * to `deleted_gallery_images` by a false-positive "orphan_page_id" dedup pass,
 * or the collection's books simply have live `gallery_images` we never pointed at.
 *
 * Per collection, in order:
 *   1. UNDELETE — re-insert any `deleted_gallery_images` rows referenced by the
 *      collection's image_ids that have NO dedup survivor (kept_id empty) and
 *      aren't already present. Re-derive image_url + denormalized book_* from
 *      the source book so they also surface in the main /gallery grid.
 *   2. PULL — if the collection still has no resolvable cover, populate
 *      image_ids from its book collection's live gallery_images (best
 *      gallery_quality first).
 *   3. Set cover_image_id to the first resolvable image and unhide.
 *   4. If nothing resolves from existing assets, leave hidden and report it
 *      (needs new art sourced online).
 *
 * Cover resolves on `extracted_url || thumbnail_url || image_url` — matching the
 * page resolver (image_url fallback added in the same change set).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/recover-hidden-gallery-collections.mjs --dry-run
 *   node scripts/maintenance/recover-hidden-gallery-collections.mjs
 */
import { MongoClient, ObjectId } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PULL = 30;
const client = new MongoClient(process.env.MONGODB_URI);

const SLUGS = [
  'collection-mandaeanism', 'collection-sikhism', 'collection-rumi',
  'collection-mesoamerican', 'collection-kashmir-shaivism',
  'collection-templar-chivalric-orders', 'collection-royal-court-poetry',
  'collection-roman-canon-law', 'collection-dreams-unconscious',
  'collection-socialist-revolutionary-thought', 'collection-kama',
];

const urlOf = (img) => img && (img.extracted_url || img.thumbnail_url || img.image_url) || null;
const TOMBSTONE = ['deleted_at', 'reason', 'kept_id', 'restored_at', 'restored_from', '_id'];

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const gc = db.collection('gallery_collections');
  const gi = db.collection('gallery_images');
  const dgi = db.collection('deleted_gallery_images');
  const booksCol = db.collection('books');

  const docs = await gc.find({ slug: { $in: SLUGS } }).toArray();

  for (const d of docs) {
    const bcs = d.book_collection_slug || d.slug.replace(/^collection-/, '');
    let undeleted = 0, pulled = 0;
    let imageIds = [...(d.image_ids || [])];

    // ---- 1. UNDELETE referenced deleted rows (no survivor, not already present)
    if (imageIds.length) {
      const present = new Set((await gi.find({ id: { $in: imageIds } }, { projection: { id: 1 } }).toArray()).map((x) => x.id));
      const delRows = await dgi.find({
        id: { $in: imageIds.filter((id) => !present.has(id)) },
        $or: [{ kept_id: { $in: [null, ''] } }, { kept_id: { $exists: false } }],
      }).toArray();
      // Re-derive book_* + image_url from the source book.
      const bookIds = [...new Set(delRows.map((r) => r.book_id).filter(Boolean))];
      const bookDocs = bookIds.length ? await booksCol.find({ $or: [{ _id: { $in: bookIds.map(safeOid).filter(Boolean) } }, { id: { $in: bookIds } }] }).project({ _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, visible: 1, image_source: 1 }).toArray() : [];
      const bookMap = new Map();
      for (const b of bookDocs) { bookMap.set(String(b._id), b); if (b.id) bookMap.set(b.id, b); }
      const inserts = delRows.map((r) => {
        const b = bookMap.get(r.book_id);
        const row = { ...r };
        for (const k of TOMBSTONE) delete row[k];
        if (!row.image_url && row.extracted_url) row.image_url = row.extracted_url;
        if (b) {
          row.book_title = b.display_title || b.title;
          row.book_author = b.author;
          row.book_year = b.year;
          row.book_language = b.language;
          row.book_visible = b.visible !== false;
          row.book_provider = b.image_source?.provider;
        }
        row.restored_at = DRY_RUN ? null : new Date();
        return row;
      });
      if (!DRY_RUN && inserts.length) await gi.insertMany(inserts, { ordered: false });
      undeleted = inserts.length;
    }

    // ---- 2. recompute resolvable cover among current image_ids
    let resolvable = [];
    if (imageIds.length) {
      const imgs = await gi.find({ id: { $in: imageIds } }, { projection: { id: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1 } }).toArray();
      const byId = new Map(imgs.map((x) => [x.id, x]));
      resolvable = imageIds.filter((id) => urlOf(byId.get(id)));
    }

    // ---- 3. PULL from the book collection's live gallery_images if still bare
    if (!resolvable.length) {
      const books = await booksCol.find({ collections: bcs }).project({ _id: 1, id: 1 }).toArray();
      const bookKeys = [...new Set(books.flatMap((b) => [String(b._id), b.id]).filter(Boolean))];
      if (bookKeys.length) {
        const imgs = await gi.find({
          book_id: { $in: bookKeys },
          $or: [{ extracted_url: { $nin: [null, ''] } }, { thumbnail_url: { $nin: [null, ''] } }, { image_url: { $nin: [null, ''] } }],
        }, { projection: { id: 1 } }).sort({ gallery_quality: -1 }).limit(MAX_PULL).toArray();
        if (imgs.length) { imageIds = imgs.map((x) => x.id); resolvable = [...imageIds]; pulled = imgs.length; }
      }
    }

    // ---- 4. apply
    if (resolvable.length) {
      const cover = resolvable[0];
      if (!DRY_RUN) await gc.updateOne({ _id: d._id }, { $set: { cover_image_id: cover, image_ids: imageIds, updated_at: new Date() }, $unset: { hidden: '' } });
      console.log(`✓ ${d.slug}: undeleted=${undeleted} pulled=${pulled} → ${resolvable.length} images, cover=${cover} — UNHIDDEN`);
    } else {
      console.log(`✗ ${d.slug}: no recoverable images from existing assets — STILL HIDDEN (needs online sourcing)`);
    }
  }
  await client.close();
}

function safeOid(s) { try { return new ObjectId(s); } catch { return null; } }

main().catch((e) => { console.error(e); process.exit(1); });
