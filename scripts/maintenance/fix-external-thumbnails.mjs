/**
 * Fix External Thumbnails
 *
 * Replaces book thumbnails that point to external URLs (IA, Gallica, IIIF, /api/image proxy)
 * with Vercel Blob URLs from the corresponding page's archived_photo.
 *
 * External URLs can 404 when source libraries go down, causing broken covers.
 * Vercel Blob URLs are on our CDN and always work.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/fix-external-thumbnails.mjs
 *   node scripts/maintenance/fix-external-thumbnails.mjs --dry-run
 *   node scripts/maintenance/fix-external-thumbnails.mjs --limit 50
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();

const BLOB_PREFIX = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 60000,
});

await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Fix External Thumbnails ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Find all books where thumbnail is NOT a Vercel Blob URL
const books = await db.collection('books').find({
  hidden: { $ne: true },
  thumbnail: {
    $exists: true,
    $ne: null,
    $not: { $regex: `^${BLOB_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
  }
}, {
  projection: { _id: 0, id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1 }
}).toArray();

console.log(`Found ${books.length} books with external thumbnails\n`);

// Categorize
const categories = { ia: 0, gallica: 0, proxy: 0, iiif: 0, vatican: 0, bodleian: 0, other: 0 };
for (const b of books) {
  const t = b.thumbnail;
  if (t.startsWith('/api/')) categories.proxy++;
  else if (t.includes('archive.org')) categories.ia++;
  else if (t.includes('gallica.bnf.fr')) categories.gallica++;
  else if (t.includes('digi.vatlib.it')) categories.vatican++;
  else if (t.includes('bodleian.ox.ac.uk')) categories.bodleian++;
  else if (t.includes('iiif')) categories.iiif++;
  else categories.other++;
}
console.log('Breakdown:', categories);

let fixed = 0, noMatch = 0, noArchive = 0;
const changes = [];
const unfixable = [];

// Process in batches of 50
const BATCH = 50;
for (let i = 0; i < books.length; i += BATCH) {
  if (LIMIT && fixed >= LIMIT) break;

  const batch = books.slice(i, i + BATCH);
  const bookIds = batch.map(b => b.id);

  // For each book, try to find the page that the thumbnail points to.
  // Strategy: decode the thumbnail URL to extract the original image URL,
  // then match against page photo/photo_original/archived_photo fields.

  // Also get page 1 as fallback
  const pages = await db.collection('pages').find({
    book_id: { $in: bookIds },
    page_number: { $lte: 20 },
  }, {
    projection: {
      book_id: 1, page_number: 1, id: 1,
      photo: 1, photo_original: 1, archived_photo: 1,
      thumbnail_blob: 1, cropped_photo: 1,
    }
  }).sort({ book_id: 1, page_number: 1 }).toArray();

  // Group by book_id
  const pagesByBook = new Map();
  for (const p of pages) {
    if (!pagesByBook.has(p.book_id)) pagesByBook.set(p.book_id, []);
    pagesByBook.get(p.book_id).push(p);
  }

  for (const book of batch) {
    if (LIMIT && fixed >= LIMIT) break;

    const bookPages = pagesByBook.get(book.id) || [];
    if (bookPages.length === 0) { noMatch++; continue; }

    // Try to find which page the thumbnail corresponds to
    let matchedPage = null;
    const thumbUrl = book.thumbnail;

    // For /api/image proxy URLs, extract the encoded source URL
    let sourceUrl = thumbUrl;
    if (thumbUrl.startsWith('/api/image?')) {
      try {
        const params = new URLSearchParams(thumbUrl.split('?')[1]);
        sourceUrl = params.get('url') || thumbUrl;
      } catch { /* use original */ }
    }

    // Try to match against page URLs
    for (const page of bookPages) {
      const pageUrls = [page.photo, page.photo_original, page.archived_photo, page.cropped_photo].filter(Boolean);
      for (const url of pageUrls) {
        if (sourceUrl === url || thumbUrl.includes(encodeURIComponent(url)) || thumbUrl === url) {
          matchedPage = page;
          break;
        }
      }
      if (matchedPage) break;
    }

    // Fallback: use page 1
    if (!matchedPage) {
      matchedPage = bookPages[0];
    }

    // Check if the matched page has an archived_photo (Vercel Blob)
    if (!matchedPage.archived_photo || !matchedPage.archived_photo.startsWith('https://')) {
      noArchive++;
      unfixable.push({ id: book.id, title: book.title?.substring(0, 50), reason: 'no archived_photo' });
      continue;
    }

    // Prefer cropped_photo for split pages, fall back to archived_photo
    const updates = { thumbnail: matchedPage.cropped_photo || matchedPage.archived_photo };
    if (matchedPage.thumbnail_blob && !book.thumbnail_blob) {
      updates.thumbnail_blob = matchedPage.thumbnail_blob;
    }

    changes.push({
      id: book.id,
      title: book.title?.substring(0, 50),
      oldType: thumbUrl.startsWith('/api/') ? 'proxy' : thumbUrl.includes('archive.org') ? 'IA' : 'external',
      page: matchedPage.page_number,
    });

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: updates }
      );
    }

    fixed++;
  }

  process.stdout.write(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(books.length / BATCH)} — ${fixed} fixed\r`);
}

console.log(`\n\n=== Results ===`);
console.log(`Total external thumbnails: ${books.length}`);
console.log(`${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixed}`);
console.log(`No matching page: ${noMatch}`);
console.log(`No archived_photo: ${noArchive}`);

if (changes.length > 0) {
  console.log(`\n--- Changes ${DRY_RUN ? '(preview)' : '(applied)'} ---`);
  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.title} | was: ${c.oldType} | page ${c.page}`);
  }
  if (changes.length > 20) console.log(`  ... and ${changes.length - 20} more`);
}

if (unfixable.length > 0 && unfixable.length <= 20) {
  console.log(`\n--- Unfixable ---`);
  for (const u of unfixable) {
    console.log(`  ${u.title} | ${u.reason}`);
  }
}

if (DRY_RUN && fixed > 0) {
  console.log(`\nRun without --dry-run to apply.`);
}

await client.close();
