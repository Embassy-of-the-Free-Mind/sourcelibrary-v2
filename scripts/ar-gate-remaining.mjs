#!/usr/bin/env node
/**
 * AR-gate all remaining needs_splitting books.
 * Checks first image aspect ratio — portrait books get marked done,
 * landscape books are flagged for actual splitting.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/ar-gate-remaining.mjs --dry-run
 *   node scripts/ar-gate-remaining.mjs
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const R2_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const MIN_SPREAD_AR = 1.1;
const CONCURRENCY = 5;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find({
  needs_splitting: true,
  split_completed: { $ne: true },
}).project({ id: 1, title: 1, pages_count: 1 })
  .sort({ pages_count: 1 })
  .toArray();

console.log(`Found ${books.length} books to AR-check`);
if (DRY_RUN) console.log('DRY RUN');

let portrait = 0, landscape = 0, noImage = 0;
const landscapes = [];

async function getFirstImageAR(bookId) {
  // Try zero-padded then plain archived paths
  for (const path of [
    `${R2_URL}/archived/${bookId}/0001.jpg`,
    `${R2_URL}/archived/${bookId}/1.jpg`,
  ]) {
    try {
      const r = await fetch(path, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      return { ar: meta.width / meta.height, w: meta.width, h: meta.height, source: 'archived' };
    } catch {}
  }

  // Fallback: check page.photo
  const page = await db.collection('pages').findOne(
    { book_id: bookId },
    { projection: { photo: 1 }, sort: { page_number: 1 } }
  );
  if (page?.photo) {
    try {
      const r = await fetch(page.photo, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      return { ar: meta.width / meta.height, w: meta.width, h: meta.height, source: 'page.photo' };
    } catch {}
  }
  return null;
}

for (let i = 0; i < books.length; i += CONCURRENCY) {
  const batch = books.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (book) => {
    const result = await getFirstImageAR(book.id);
    if (!result) {
      noImage++;
      return;
    }

    if (result.ar >= MIN_SPREAD_AR) {
      landscape++;
      landscapes.push({
        id: book.id,
        title: book.title?.slice(0, 60),
        ar: result.ar.toFixed(2),
        pages: book.pages_count,
        source: result.source,
      });
    } else {
      portrait++;
      if (!DRY_RUN) {
        await db.collection('books').updateOne({ id: book.id }, {
          $set: {
            needs_splitting: false,
            split_completed: true,
            split_note: `AR gate: ${result.ar.toFixed(2)} — portrait`,
          },
        });
      }
    }
  }));
  process.stderr.write(`\r  ${Math.min(i + CONCURRENCY, books.length)}/${books.length} checked`);
}

console.log('\n');
console.log(`=== Results ===`);
console.log(`Portrait (done): ${portrait}`);
console.log(`Landscape (need splitting): ${landscape}`);
console.log(`No image: ${noImage}`);

if (landscapes.length > 0) {
  console.log('\nLandscape books (actual spreads):');
  for (const l of landscapes) {
    console.log(`  AR ${l.ar} | ${l.pages}pp | ${l.source} | ${l.title}`);
  }
}

await client.close();
