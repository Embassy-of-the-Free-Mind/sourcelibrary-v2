#!/usr/bin/env node
/**
 * Audit BPH books for duplicate spread photographs.
 *
 * The BPH scanner intermittently re-photographed the same page opening twice,
 * producing duplicate page pairs after splitting. This script detects them by
 * comparing OCR text between consecutive spread pairs.
 *
 * Detection: group pages by spread (shared photo_original), then for consecutive
 * spread pairs, compare BOTH left and right sides via Jaccard word similarity.
 * If both sides match (>50%), the second spread is a duplicate re-photograph.
 *
 * READ-ONLY — outputs a report, does not modify any data.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit-bph-duplicate-spreads.mjs                    # audit all BPH books
 *   node scripts/audit-bph-duplicate-spreads.mjs --book BOOK_ID     # audit one book
 *   node scripts/audit-bph-duplicate-spreads.mjs --limit 50         # audit first 50
 *   node scripts/audit-bph-duplicate-spreads.mjs --threshold 0.4    # lower similarity threshold
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const bookOverride = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const threshold = args.includes('--threshold') ? parseFloat(args[args.indexOf('--threshold') + 1]) : 0.5;

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function jaccard(textA, textB) {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 && wordsB.size === 0) return 1; // both empty = match
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

async function auditBook(db, bookId) {
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, {
      projection: { page_number: 1, crop: 1, photo_original: 1, 'ocr.data': 1 },
    })
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length < 4) return null;

  // Group pages into spreads by photo_original
  const spreads = [];
  let currentSpread = null;
  for (const page of pages) {
    if (!page.photo_original) {
      // Single page (no spread)
      if (currentSpread) spreads.push(currentSpread);
      currentSpread = null;
      continue;
    }
    if (!currentSpread || currentSpread.photo !== page.photo_original) {
      if (currentSpread) spreads.push(currentSpread);
      currentSpread = { photo: page.photo_original, pages: [] };
    }
    currentSpread.pages.push(page);
  }
  if (currentSpread) spreads.push(currentSpread);

  // Compare consecutive spread pairs
  const duplicateSpreads = [];
  for (let i = 0; i < spreads.length - 1; i++) {
    const spreadA = spreads[i];
    const spreadB = spreads[i + 1];

    // Only compare spreads with exactly 2 pages each (LEFT + RIGHT)
    if (spreadA.pages.length !== 2 || spreadB.pages.length !== 2) continue;

    const [leftA, rightA] = spreadA.pages;
    const [leftB, rightB] = spreadB.pages;

    const textLeftA = stripTags(leftA.ocr?.data).substring(0, 500);
    const textLeftB = stripTags(leftB.ocr?.data).substring(0, 500);
    const textRightA = stripTags(rightA.ocr?.data).substring(0, 500);
    const textRightB = stripTags(rightB.ocr?.data).substring(0, 500);

    const leftSim = jaccard(textLeftA, textLeftB);
    const rightSim = jaccard(textRightA, textRightB);

    // Both sides must match for it to be a duplicate spread
    if (leftSim >= threshold && rightSim >= threshold) {
      duplicateSpreads.push({
        spreadA: { pages: [leftA.page_number, rightA.page_number], photo: spreadA.photo.split('/').pop() },
        spreadB: { pages: [leftB.page_number, rightB.page_number], photo: spreadB.photo.split('/').pop() },
        leftSimilarity: leftSim,
        rightSimilarity: rightSim,
      });
    }
  }

  if (duplicateSpreads.length === 0) return null;

  return {
    bookId,
    totalPages: pages.length,
    totalSpreads: spreads.length,
    duplicateSpreads: duplicateSpreads.length,
    duplicatePages: duplicateSpreads.length * 2,
    details: duplicateSpreads,
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  if (bookOverride) {
    // Single book mode
    const book = await db.collection('books').findOne(
      { $or: [{ id: bookOverride }, { slug: bookOverride }] },
      { projection: { id: 1, title: 1, pages_count: 1 } },
    );
    if (!book) { console.log('Book not found:', bookOverride); process.exit(1); }

    console.log(`Auditing: ${book.title} (${book.pages_count} pages)`);
    const result = await auditBook(db, book.id);
    if (!result) {
      console.log('No duplicate spreads found.');
    } else {
      console.log(`\nFound ${result.duplicateSpreads} duplicate spreads (${result.duplicatePages} pages to remove)`);
      console.log(`${result.totalPages} → ${result.totalPages - result.duplicatePages} pages\n`);
      for (const d of result.details) {
        console.log(`  Spread ${d.spreadA.pages.join(',')} = Spread ${d.spreadB.pages.join(',')}  (L:${(d.leftSimilarity*100).toFixed(0)}% R:${(d.rightSimilarity*100).toFixed(0)}%)`);
      }
    }
  } else {
    // Batch mode — all BPH books with split pages
    const bphBooks = await db.collection('books')
      .find(
        { 'image_source.provider': 'bph', pages_count: { $gt: 20 } },
        { projection: { id: 1, title: 1, pages_count: 1 } },
      )
      .sort({ pages_count: -1 })
      .limit(limit || 0)
      .toArray();

    console.log(`Auditing ${bphBooks.length} BPH books (threshold: ${threshold})...\n`);

    let totalAffected = 0;
    let totalDupePages = 0;
    let totalBooks = 0;
    const affected = [];

    for (let i = 0; i < bphBooks.length; i++) {
      const book = bphBooks[i];
      if (i > 0 && i % 50 === 0) {
        console.log(`  ... ${i}/${bphBooks.length} checked, ${totalAffected} affected so far`);
      }

      try {
        const result = await auditBook(db, book.id);
        totalBooks++;
        if (result) {
          totalAffected++;
          totalDupePages += result.duplicatePages;
          affected.push({
            title: book.title?.substring(0, 50),
            pages: result.totalPages,
            dupeSpreads: result.duplicateSpreads,
            dupePages: result.duplicatePages,
            afterDedup: result.totalPages - result.duplicatePages,
            id: book.id,
          });
        }
      } catch (err) {
        console.error(`  Error on ${book.title}: ${err.message?.slice(0, 100)}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log(`Books checked: ${totalBooks}`);
    console.log(`Books with duplicate spreads: ${totalAffected}`);
    console.log(`Total duplicate pages: ${totalDupePages}`);
    console.log(`\nAffected books:`);
    console.log('Title'.padEnd(52) + 'Pages'.padStart(6) + ' Dupes'.padStart(6) + ' After'.padStart(6));
    console.log('-'.repeat(70));
    for (const b of affected.sort((a, b) => b.dupePages - a.dupePages)) {
      console.log(
        b.title.padEnd(52) +
        String(b.pages).padStart(6) +
        String(b.dupePages).padStart(6) +
        String(b.afterDedup).padStart(6)
      );
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
