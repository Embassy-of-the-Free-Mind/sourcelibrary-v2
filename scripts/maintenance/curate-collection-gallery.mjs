/**
 * Curate the best gallery images per collection.
 *
 * Picks the top 5 gallery images for each collection (by gallery_quality),
 * diversified across books (max 1 per book), and stores them as
 * `curated_gallery` on the collection document.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/curate-collection-gallery.mjs
 * Safe to re-run anytime — idempotent, just overwrites curated_gallery.
 */
import { MongoClient } from 'mongodb';

const IMAGES_PER_COLLECTION = 5;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const collections = await db.collection('collections').find({}).toArray();
  console.log(`Processing ${collections.length} collections...`);

  for (const col of collections) {
    const slug = col.slug;

    // Get all book IDs in this collection
    const books = await db.collection('books').find(
      { collections: slug, hidden: { $ne: true }, gallery_exclude: { $ne: true } },
      { projection: { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1 } }
    ).toArray();

    const bookIds = books.map(b => b.id);
    const bookSlugMap = new Map(books.map(b => [b.id, b.slug]));

    if (bookIds.length === 0) {
      console.log(`  ${slug}: no books, skipping`);
      continue;
    }

    // Find the best gallery images across all books in this collection
    const images = await db.collection('gallery_images')
      .find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.85 },
        museum_description: { $exists: true, $ne: '' },
        $or: [
          { extracted_url: { $type: 'string', $gt: '' } },
          { thumbnail_url: { $type: 'string', $gt: '' } },
        ],
      })
      .sort({ gallery_quality: -1 })
      .limit(200)
      .toArray();

    // Pick top images, max 1 per book for diversity
    const picked = [];
    const seenBooks = new Set();
    for (const img of images) {
      if (seenBooks.has(img.book_id)) continue;
      seenBooks.add(img.book_id);
      picked.push({
        id: `${img.page_id}-${img.detection_index}`,
        image_url: img.extracted_url || img.thumbnail_url,
        type: img.type || '',
        museum_description: img.museum_description || '',
        book_title: img.book_title || '',
        book_id: img.book_id,
        book_slug: bookSlugMap.get(img.book_id) || '',
        gallery_quality: img.gallery_quality,
      });
      if (picked.length >= IMAGES_PER_COLLECTION) break;
    }

    // Store on collection document
    await db.collection('collections').updateOne(
      { _id: col._id },
      { $set: { curated_gallery: picked, curated_gallery_updated: new Date() } }
    );

    const qualities = picked.map(p => p.gallery_quality.toFixed(2)).join(', ');
    console.log(`  ${slug}: ${picked.length} images (quality: ${qualities})`);
  }

  await client.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
