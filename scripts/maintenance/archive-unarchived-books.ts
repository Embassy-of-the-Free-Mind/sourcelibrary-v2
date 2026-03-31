/**
 * Archive images for books that have no R2-archived pages.
 *
 * Instead of scanning the 9.5M pages collection, this queries
 * the books collection first to find unarchived books, then
 * processes them one book at a time using the page-level archiver.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/archive-unarchived-books.mjs
 *   --limit N          Process at most N books
 *   --source ia        Only process books from this provider
 *   --concurrency N    Parallel image downloads per book (default 10)
 *   --dry-run          Just list books that would be archived
 *   --exclude-source X Skip this source (e.g. erara)
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { storagePut } from '../../src/lib/storage';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const SOURCE = (() => {
  const idx = process.argv.indexOf('--source');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const EXCLUDE_SOURCE = (() => {
  const idx = process.argv.indexOf('--exclude-source');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const CONCURRENCY = (() => {
  const idx = process.argv.indexOf('--concurrency');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 10;
})();

const DOWNLOAD_TIMEOUT = 30000;
const MAX_RETRIES = 3;

// Rate limiter per domain
const domainBuckets = new Map();
const DOMAIN_LIMITS = {
  'archive.org': 10, 'gallica.bnf.fr': 3, 'api.digitale-sammlungen.de': 5,
  'iiif.wellcomecollection.org': 5, 'www.e-rara.ch': 2, 'digi.vatlib.it': 3,
  'iiif.bodleian.ox.ac.uk': 3, 'images.lib.cam.ac.uk': 3, 'image.digitalcollections.manchester.ac.uk': 3,
  'images.uba.uva.nl': 3, 'cdm21059.contentdm.oclc.org': 3, 'dl.ndl.go.jp': 3,
};

function getDomainLimit(url) {
  try { const host = new URL(url).hostname; return DOMAIN_LIMITS[host] || 5; }
  catch { return 5; }
}

async function rateLimitedFetch(url) {
  let host;
  try { host = new URL(url).hostname; } catch { host = 'unknown'; }
  const limit = getDomainLimit(url);

  if (!domainBuckets.has(host)) domainBuckets.set(host, { last: 0, count: 0 });
  const bucket = domainBuckets.get(host);

  const now = Date.now();
  if (now - bucket.last > 1000) { bucket.count = 0; bucket.last = now; }
  if (bucket.count >= limit) {
    const wait = 1000 - (now - bucket.last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    bucket.count = 0;
    bucket.last = Date.now();
  }
  bucket.count++;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)' }
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function archivePage(db, page) {
  const sourceUrl = page.photo_original || page.photo;
  if (!sourceUrl || sourceUrl.startsWith('failed:')) return 'skip';
  if (!sourceUrl.startsWith('http')) return 'skip';

  // Already archived
  if (page.archived_photo?.startsWith('http')) return 'skip';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const imageBuffer = await rateLimitedFetch(sourceUrl);

      // Process with sharp — resize to max 2000px wide, JPEG 85%
      const processed = await sharp(imageBuffer)
        .rotate() // auto-rotate EXIF
        .resize(2000, null, { withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();

      // Upload to storage
      const padded = String(page.page_number).padStart(4, '0');
      const storagePath = `pages/${page.book_id}/${padded}.jpg`;
      const blob = await storagePut(storagePath, processed, {
        contentType: 'image/jpeg',
        access: 'public',
      });

      // Update page in DB
      const update = { $set: { archived_photo: blob.url } };

      // Also generate 150px thumbnail
      try {
        const thumb = await sharp(imageBuffer)
          .rotate()
          .resize(150, null, { withoutEnlargement: true })
          .jpeg({ quality: 60 })
          .toBuffer();
        const thumbPath = `pages/${page.book_id}/${padded}-thumb.jpg`;
        const thumbBlob = await storagePut(thumbPath, thumb, {
          contentType: 'image/jpeg',
          access: 'public',
        });
        update.$set.thumbnail_blob = thumbBlob.url;
      } catch { /* thumbnail is optional */ }

      // Try live pages first, fall back to warehouse
      const result = await db.collection('pages').updateOne({ _id: page._id }, update);
      if (result.matchedCount === 0) {
        await db.collection('pages_warehouse').updateOne({ _id: page._id }, update);
      }

      return 'ok';
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('429') || msg.includes('503')) {
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (attempt === MAX_RETRIES - 1) {
        // Mark as failed
        const failUpdate = { $set: { archived_photo: `failed:${msg.slice(0, 80)}` } };
        await db.collection('pages').updateOne({ _id: page._id }, failUpdate).catch(() => {});
        return 'fail';
      }
    }
  }
  return 'fail';
}

// --- Main ---
const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 120000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Archive Unarchived Books ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Concurrency: ${CONCURRENCY}`);
if (SOURCE) console.log(`Source: ${SOURCE}`);
if (EXCLUDE_SOURCE) console.log(`Excluding: ${EXCLUDE_SOURCE}`);
if (LIMIT) console.log(`Limit: ${LIMIT} books`);

// Step 1: Find books with non-R2 thumbnails (fast query on books collection)
const bookQuery = {
  pages_count: { $gt: 0 },
  visible: true,
  thumbnail: { $exists: true, $not: /images\.sourcelibrary\.org/ },
};
if (SOURCE) bookQuery['image_source.provider'] = SOURCE;
if (EXCLUDE_SOURCE) bookQuery['image_source.provider'] = { $ne: EXCLUDE_SOURCE };

const books = await db.collection('books')
  .find(bookQuery, { projection: { id: 1, title: 1, pages_count: 1, 'image_source.provider': 1, _id: 0 } })
  .sort({ pages_count: 1 }) // smallest books first for quick wins
  .toArray();

const toProcess = LIMIT ? books.slice(0, LIMIT) : books;
const totalPages = toProcess.reduce((sum, b) => sum + (b.pages_count || 0), 0);
console.log(`Found ${books.length} unarchived books (${totalPages.toLocaleString()} pages). Processing ${toProcess.length}.\n`);

if (DRY_RUN) {
  for (const b of toProcess.slice(0, 50)) {
    console.log(`  ${b.title?.substring(0, 55)} — ${b.pages_count} pages (${b.image_source?.provider})`);
  }
  if (toProcess.length > 50) console.log(`  ... and ${toProcess.length - 50} more`);
  await client.close();
  process.exit(0);
}

let booksProcessed = 0, pagesArchived = 0, pagesFailed = 0, pagesSkipped = 0;
const startTime = Date.now();

for (const book of toProcess) {
  booksProcessed++;

  // Fetch all pages for this book that need archiving
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, archived_photo: { $exists: false } },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  // Also check warehouse
  const warehousePages = await db.collection('pages_warehouse')
    .find(
      { book_id: book.id, archived_photo: { $exists: false } },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  const allPages = [...pages, ...warehousePages];
  if (allPages.length === 0) continue;

  // Process pages with concurrency
  let bookOk = 0, bookFail = 0;
  const queue = [...allPages];

  async function worker() {
    while (queue.length > 0) {
      const page = queue.shift();
      if (!page) break;
      const result = await archivePage(db, page);
      if (result === 'ok') { pagesArchived++; bookOk++; }
      else if (result === 'fail') { pagesFailed++; bookFail++; }
      else pagesSkipped++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = (pagesArchived / ((Date.now() - startTime) / 1000)).toFixed(1);
  console.log(`[${booksProcessed}/${toProcess.length}] ${book.title?.substring(0, 45)} — ${bookOk}/${allPages.length} pages (${rate} p/s, ${elapsed}s)`);
}

// Update book thumbnails to use R2 URLs
console.log(`\nUpdating thumbnails to R2 URLs...`);
let thumbsFixed = 0;
for (const book of toProcess) {
  // Find the current cover page and get its archived_photo
  const currentBook = await db.collection('books').findOne(
    { id: book.id },
    { projection: { thumbnail: 1, cover_page_number: 1 } }
  );
  if (!currentBook?.thumbnail) continue;
  if (currentBook.thumbnail.includes('images.sourcelibrary.org')) continue;

  // Find the page that matches the current thumbnail
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, page_number: { $lte: 20 } },
      { projection: { page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, _id: 0 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  // Find the page whose original URL matches the current thumbnail
  const coverPage = pages.find(p => {
    const urls = [p.photo, p.photo_original, p.cropped_photo].filter(Boolean);
    return urls.some(u => currentBook.thumbnail === u || currentBook.thumbnail.includes(u));
  });

  if (coverPage?.archived_photo?.startsWith('http')) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { thumbnail: coverPage.archived_photo } }
    );
    thumbsFixed++;
  }
}

const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\n=== Results ===`);
console.log(`Books processed: ${booksProcessed}`);
console.log(`Pages archived: ${pagesArchived}`);
console.log(`Pages failed: ${pagesFailed}`);
console.log(`Pages skipped: ${pagesSkipped}`);
console.log(`Thumbnails switched to R2: ${thumbsFixed}`);
console.log(`Time: ${totalElapsed} minutes`);

await client.close();
