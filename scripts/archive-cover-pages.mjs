#!/usr/bin/env node
/**
 * Archive just the first N pages of books that have no archived images yet.
 * This gives us enough to pick a good cover without archiving 500+ pages.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/archive-cover-pages.mjs        # preview
 *   node scripts/archive-cover-pages.mjs                    # run
 *   LIMIT=50 node scripts/archive-cover-pages.mjs           # process 50 books
 *   COLLECTION=islam node scripts/archive-cover-pages.mjs   # single collection
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from './lib/r2-key.mjs';

// Writes go to R2, never Vercel Blob. This script imported `put` from
// '@vercel/blob' directly, which bypassed both the shared writer and its key
// guards, and wrote new objects into the very store #3645 is trying to retire.
// Same client + key-guard shape as scripts/maintenance/archive-ia-bulk.mjs.
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const DRY_RUN = process.env.DRY_RUN === '1';
const BOOK_LIMIT = parseInt(process.env.LIMIT || '100');
const COLLECTION_FILTER = process.env.COLLECTION || null;
const PAGES_PER_BOOK = 10; // enough for cover selection
const BATCH_SIZE = 3; // concurrent image downloads per book
const DELAY_BETWEEN_BOOKS = 1000; // ms

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Archivable source pattern
const ARCHIVABLE_RE = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de/;

// Find books with zero archived pages but with archivable source URLs
let bookFilter = {
  thumbnail: { $exists: true },
  hidden: { $ne: true },
};
if (COLLECTION_FILTER) {
  bookFilter.collections = COLLECTION_FILTER;
}

// Get books that have NO archived pages at all
const pipeline = [
  { $match: bookFilter },
  { $project: { id: 1, title: 1, slug: 1 } },
  // Must have at least one archivable page
  {
    $lookup: {
      from: 'pages',
      let: { bid: '$id' },
      pipeline: [
        { $match: {
          $expr: { $eq: ['$book_id', '$$bid'] },
          $or: [
            { photo: { $regex: /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de/ } },
            { photo_original: { $regex: /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de/ } },
          ],
        }},
        { $limit: 1 },
      ],
      as: 'hasArchivable',
    },
  },
  { $match: { hasArchivable: { $ne: [] } } },
  // Must NOT have any archived pages yet
  {
    $lookup: {
      from: 'pages',
      let: { bid: '$id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$book_id', '$$bid'] }, archived_photo: { $exists: true, $ne: '' } } },
        { $limit: 1 },
      ],
      as: 'alreadyArchived',
    },
  },
  { $match: { alreadyArchived: { $size: 0 } } },
  { $project: { id: 1, title: 1, slug: 1 } },
  { $limit: BOOK_LIMIT },
];

console.log(`Finding books with no archived pages...`);
if (COLLECTION_FILTER) console.log(`Collection: ${COLLECTION_FILTER}`);
const books = await db.collection('books').aggregate(pipeline).toArray();
console.log(`Found ${books.length} books needing cover page archiving`);
if (DRY_RUN) console.log('DRY RUN — no changes\n');

let totalArchived = 0;
let totalBooks = 0;
let errors = 0;

for (const book of books) {
  // Get first N pages with archivable URLs
  const pages = await db.collection('pages').find({
    book_id: book.id,
    page_number: { $lte: PAGES_PER_BOOK },
    $and: [
      { $or: [
        { archived_photo: { $exists: false } },
        { archived_photo: null },
        { archived_photo: '' },
      ]},
      { $or: [
        { photo: { $regex: ARCHIVABLE_RE } },
        { photo_original: { $regex: ARCHIVABLE_RE } },
      ]},
    ],
  }).sort({ page_number: 1 }).toArray();

  if (pages.length === 0) continue;

  console.log(`\n${book.title} — archiving ${pages.length} cover pages`);

  if (DRY_RUN) {
    pages.forEach(p => console.log(`  Page ${p.page_number}: ${(p.photo_original || p.photo).substring(0, 80)}`));
    totalArchived += pages.length;
    totalBooks++;
    continue;
  }

  // Archive in small batches
  let bookArchived = 0;
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (page) => {
        const sourceUrl = page.photo_original || page.photo;
        try {
          // Download
          const resp = await fetch(sourceUrl, {
            headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly digitization project; contact@sourcelibrary.org)' },
            signal: AbortSignal.timeout(30000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buffer = Buffer.from(await resp.arrayBuffer());
          const mimeType = resp.headers.get('content-type') || 'image/jpeg';

          // Upload to R2. The key MUST carry this book's id — a book-independent
          // page key is shared between books by construction and nothing
          // downstream can detect it (#3362).
          const filename = `archived/${book.id}/${page.page_number}.jpg`;
          assertBookScopedKey(filename, book.id, 'archive-cover-pages');
          const uploadedUrl = await uploadToR2(filename, buffer, mimeType);

          // Update page
          await db.collection('pages').updateOne(
            { _id: page._id },
            {
              $set: {
                archived_photo: uploadedUrl,
                'archive_metadata.archived_at': new Date(),
                'archive_metadata.source_url': sourceUrl,
                'archive_metadata.bytes': buffer.byteLength,
                updated_at: new Date(),
              },
            }
          );

          console.log(`  Page ${page.page_number} ✓ (${(buffer.byteLength / 1024).toFixed(0)}KB)`);
          return true;
        } catch (e) {
          console.log(`  Page ${page.page_number} ✗ ${e.message}`);
          errors++;
          return false;
        }
      })
    );
    bookArchived += results.filter(r => r.status === 'fulfilled' && r.value).length;
  }

  totalArchived += bookArchived;
  totalBooks++;

  // Now pick the best cover from the newly archived pages
  if (bookArchived > 0) {
    const archivedPages = await db.collection('pages').find({
      book_id: book.id,
      page_number: { $lte: PAGES_PER_BOOK },
      archived_photo: { $exists: true, $ne: '' },
    }, {
      projection: { page_number: 1, page_type: 1, archived_photo: 1, 'ocr.data': 1 },
      sort: { page_number: 1 },
    }).toArray();

    // Pick: title-page > frontispiece > first non-blank
    let best = archivedPages.find(p => p.page_type === 'title-page');
    if (!best) best = archivedPages.find(p => p.page_type === 'frontispiece');
    if (!best) best = archivedPages.find(p => p.page_type && p.page_type !== 'blank' && p.page_type !== 'digitizer-insert');
    if (!best) best = archivedPages[0];

    if (best?.archived_photo) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { thumbnail: best.archived_photo, thumbnail_source: 'auto' } }
      );
      console.log(`  → Cover set to page ${best.page_number} (${best.page_type || 'unclassified'})`);
    }
  }

  // Rate limit
  await new Promise(r => setTimeout(r, DELAY_BETWEEN_BOOKS));
}

console.log(`\nDone. Books: ${totalBooks}, Pages archived: ${totalArchived}, Errors: ${errors}`);
if (DRY_RUN) console.log('(DRY RUN — re-run without DRY_RUN=1 to apply)');

await client.close();
