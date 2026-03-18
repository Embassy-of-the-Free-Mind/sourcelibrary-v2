/**
 * Curate the best gallery images per collection.
 *
 * Prioritizes images that have been liked (hearted) in /gallery/curate,
 * then fills remaining slots from the highest gallery_quality scores.
 * Diversified across books (max 1 per book).
 *
 * Stores results as `curated_gallery` on the collection document.
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

  // Build a set of all liked gallery image IDs (format: "pageId-detectionIndex")
  const allLikes = await db.collection('likes')
    .find({ target_type: 'image' })
    .toArray();
  // Count likes per image — more likes = higher priority
  const likeCounts = new Map();
  for (const like of allLikes) {
    const id = like.target_id;
    likeCounts.set(id, (likeCounts.get(id) || 0) + 1);
  }
  console.log(`Found ${likeCounts.size} liked images across all collections`);

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

    // Find candidate gallery images across all books in this collection
    // Exclude types that don't showcase well in the carousel:
    // - portrait: often modern photos of people, not historical art
    // - decorative: borders, stamps, printer marks — low visual impact
    // - symbol: small marks, seals
    // Liked images bypass this filter (handled below)
    const images = await db.collection('gallery_images')
      .find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.75 },
        museum_description: { $exists: true, $ne: '' },
        type: { $nin: ['portrait', 'decorative', 'symbol'] },
        $or: [
          { extracted_url: { $type: 'string', $gt: '' } },
          { thumbnail_url: { $type: 'string', $gt: '' } },
        ],
      })
      .sort({ gallery_quality: -1 })
      .limit(500)
      .toArray();

    // Also fetch liked images that may have been excluded by type filter
    const likedInCollection = images.length < 500
      ? await db.collection('gallery_images')
          .find({
            book_id: { $in: bookIds },
            museum_description: { $exists: true, $ne: '' },
            $or: [
              { extracted_url: { $type: 'string', $gt: '' } },
              { thumbnail_url: { $type: 'string', $gt: '' } },
            ],
          })
          .toArray()
          .then(all => all.filter(img => likeCounts.has(`${img.page_id}-${img.detection_index}`)))
      : [];

    // Merge liked images that weren't already in the main query
    const imageIds = new Set(images.map(img => `${img.page_id}-${img.detection_index}`));
    for (const img of likedInCollection) {
      const id = `${img.page_id}-${img.detection_index}`;
      if (!imageIds.has(id)) {
        images.push(img);
        imageIds.add(id);
      }
    }

    // Score each image: liked images get a massive boost
    const scored = images.map(img => {
      const imageId = `${img.page_id}-${img.detection_index}`;
      const likes = likeCounts.get(imageId) || 0;
      return {
        img,
        imageId,
        likes,
        // Liked images sort first (by like count), then by quality
        score: likes > 0 ? 1000 + likes + img.gallery_quality : img.gallery_quality,
      };
    });
    scored.sort((a, b) => b.score - a.score);

    // Pick top images, max 1 per book for diversity
    const picked = [];
    const seenBooks = new Set();
    for (const { img, imageId, likes } of scored) {
      if (seenBooks.has(img.book_id)) continue;
      seenBooks.add(img.book_id);
      picked.push({
        id: imageId,
        image_url: img.extracted_url || img.thumbnail_url,
        type: img.type || '',
        museum_description: img.museum_description || '',
        book_title: img.book_title || '',
        book_id: img.book_id,
        book_slug: bookSlugMap.get(img.book_id) || '',
        gallery_quality: img.gallery_quality,
        liked: likes > 0,
      });
      if (picked.length >= IMAGES_PER_COLLECTION) break;
    }

    // Store on collection document
    await db.collection('collections').updateOne(
      { _id: col._id },
      { $set: { curated_gallery: picked, curated_gallery_updated: new Date() } }
    );

    const likedCount = picked.filter(p => p.liked).length;
    const qualities = picked.map(p => `${p.gallery_quality.toFixed(2)}${p.liked ? '♥' : ''}`).join(', ');
    console.log(`  ${slug}: ${picked.length} images (${likedCount} liked) [${qualities}]`);
  }

  await client.close();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
