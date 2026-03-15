#!/usr/bin/env node
/**
 * Backfill content_hash (SHA-256) on all pages with OCR or translation data.
 *
 * Processes book-by-book to avoid cursor timeouts on large collections.
 * Safe to re-run — skips pages that already have content_hash.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-content-hashes.mjs
 */

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function backfill() {
  const client = await MongoClient.connect(MONGODB_URI, {
    socketTimeoutMS: 120000,
    serverSelectionTimeoutMS: 30000,
  });
  const db = client.db('bookstore');
  const pages = db.collection('pages');

  // Get all book IDs that have translated or OCR'd pages
  const books = await db.collection('books').find(
    { $or: [{ pages_translated: { $gt: 0 } }, { pages_ocr: { $gt: 0 } }] },
    { projection: { _id: 1, title: 1, pages_translated: 1, pages_ocr: 1 } }
  ).toArray();

  console.log(`Processing ${books.length} books...\n`);

  let totalTranslation = 0;
  let totalOcr = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const bookId = book._id.toString();
    let bookT = 0, bookO = 0;

    // Translation hashes for this book
    if (book.pages_translated > 0) {
      const tPages = await pages.find(
        { book_id: bookId, 'translation.data': { $exists: true, $ne: '' }, 'translation.content_hash': { $exists: false } },
        { projection: { _id: 1, 'translation.data': 1 } }
      ).toArray();

      if (tPages.length > 0) {
        const ops = tPages
          .filter(p => p.translation?.data)
          .map(p => ({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { 'translation.content_hash': contentHash(p.translation.data) } }
            }
          }));
        if (ops.length > 0) {
          await pages.bulkWrite(ops, { ordered: false });
          bookT = ops.length;
        }
      }
    }

    // OCR hashes for this book
    if (book.pages_ocr > 0) {
      const oPages = await pages.find(
        { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' }, 'ocr.content_hash': { $exists: false } },
        { projection: { _id: 1, 'ocr.data': 1 } }
      ).toArray();

      if (oPages.length > 0) {
        const ops = oPages
          .filter(p => p.ocr?.data)
          .map(p => ({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { 'ocr.content_hash': contentHash(p.ocr.data) } }
            }
          }));
        if (ops.length > 0) {
          await pages.bulkWrite(ops, { ordered: false });
          bookO = ops.length;
        }
      }
    }

    totalTranslation += bookT;
    totalOcr += bookO;

    if (bookT > 0 || bookO > 0) {
      process.stdout.write(`\r[${i + 1}/${books.length}] ${totalTranslation.toLocaleString()} translations, ${totalOcr.toLocaleString()} OCR hashed`);
    }
  }

  await client.close();
  console.log(`\n\nDone. ${totalTranslation.toLocaleString()} translations + ${totalOcr.toLocaleString()} OCR = ${(totalTranslation + totalOcr).toLocaleString()} total.`);
}

backfill().catch(e => { console.error(e); process.exit(1); });
