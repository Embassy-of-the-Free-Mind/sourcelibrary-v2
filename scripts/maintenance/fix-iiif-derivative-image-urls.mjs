/**
 * Fix page image_urls for IA-sourced books whose Internet Archive derivative
 * was named differently from the item identifier.
 *
 * Background
 * ----------
 * The standard IA image URLs (BookReader `<identifier>_jp2.zip` and the simple
 * IIIF `<identifier>$<n>` form) only resolve when the item's processed-JP2
 * derivative is literally named `<identifier>_jp2.zip`. When an uploader hands
 * IA a custom zip (e.g. `sutra_images.zip`), IA derives `sutra_jp2.zip` instead,
 * so every stored page URL 404s and the simple IIIF form silently returns the
 * SAME image for every page index. Result: no cover, and the reader shows one
 * page repeated N times.
 *
 * Fix: read the item's IIIF v3 manifest (the only derivative-name-independent
 * source of per-page image URLs), map each canvas to its 1-indexed page, write
 * the correct `image_url` onto every page doc, and set the book cover from the
 * first page.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/fix-iiif-derivative-image-urls.mjs <bookId> [--dry]
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}
const DB_NAME = process.env.MONGODB_DB || 'bookstore';

const bookId = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!bookId) {
  console.error('Usage: node fix-iiif-derivative-image-urls.mjs <bookId> [--dry]');
  process.exit(1);
}

/** Pull the ordered list of per-page image URLs from an IA IIIF v3 manifest. */
async function manifestPageUrls(iaId) {
  const url = `https://iiif.archive.org/iiif/${encodeURIComponent(iaId)}/manifest.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org)' },
  });
  if (!res.ok) throw new Error(`manifest fetch ${res.status} for ${iaId}`);
  const manifest = await res.json();
  const canvases = manifest.items || [];
  return canvases.map((c) => {
    const body = c?.items?.[0]?.items?.[0]?.body;
    return body?.id || null; // full/max/0/default.jpg image URL
  });
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(DB_NAME);

const { ObjectId } = await import('mongodb');
const book = await db.collection('books').findOne({ _id: new ObjectId(bookId) });
if (!book) {
  console.error('Book not found:', bookId);
  process.exit(1);
}
const iaId = book.ia_identifier || book.image_source?.identifier;
if (!iaId) {
  console.error('Book has no IA identifier; cannot rebuild IIIF URLs.');
  process.exit(1);
}

console.log(`Book: ${book.title}`);
console.log(`IA identifier: ${iaId}`);

const urls = await manifestPageUrls(iaId);
console.log(`Manifest canvases: ${urls.length}`);
if (urls.some((u) => !u)) {
  console.error('Some canvases had no resolvable image URL — aborting.');
  process.exit(1);
}

const pages = await db
  .collection('pages')
  .find({ book_id: bookId })
  .project({ page_number: 1, image_url: 1 })
  .sort({ page_number: 1 })
  .toArray();
console.log(`Page docs: ${pages.length}`);

if (pages.length !== urls.length) {
  console.warn(
    `WARNING: page-doc count (${pages.length}) != manifest canvases (${urls.length}). ` +
      `Mapping by page_number → canvas[page_number-1] for the overlap only.`
  );
}

let updated = 0;
for (const p of pages) {
  const idx = p.page_number - 1; // pages are 1-indexed; canvases 0-indexed
  const newUrl = urls[idx];
  if (!newUrl) continue;
  if (p.image_url === newUrl) continue;
  if (!DRY) {
    await db
      .collection('pages')
      .updateOne(
        { book_id: bookId, page_number: p.page_number },
        { $set: { image_url: newUrl, image_url_source: 'iiif-manifest' } }
      );
  }
  updated++;
}
console.log(`${DRY ? '[dry] would update' : 'Updated'} ${updated} page image_urls.`);

// Set the cover from page 1 (first canvas) if not already a working cover.
const coverUrl = urls[0];
if (coverUrl) {
  if (!DRY) {
    await db.collection('books').updateOne(
      { _id: new ObjectId(bookId) },
      {
        $set: {
          cover: coverUrl,
          cover_page: 1,
          cover_source: 'iiif',
          updated_at: new Date(),
        },
      }
    );
  }
  console.log(`${DRY ? '[dry] would set' : 'Set'} cover -> ${coverUrl}`);
}

await client.close();
console.log('Done. Next: run scripts/maintenance/sync-books-catalog.mjs to push cover_image to Supabase.');
