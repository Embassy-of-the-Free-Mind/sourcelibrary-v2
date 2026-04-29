#!/usr/bin/env node
/**
 * Phase 2: Dry-run audit of all 830 AR-gate-missed books.
 *
 * For each book, samples 4 pages (5%, 25%, 50%, 75%) and:
 *   - Checks if page is portrait or landscape
 *   - Runs gutter detection on landscape pages
 *   - Flags anomalies (offset >5%, ambiguous AR, narrow halves)
 *
 * Outputs JSON report to stdout, progress to stderr.
 *
 * Usage:
 *   node scripts/tmp-split-audit-v2.mjs [--limit N] > split-audit-report.json
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 0;
})();

function detectGutter(data, targetW, targetH) {
  const center = Math.floor(targetW / 2);
  const searchStart = Math.floor(targetW * 0.45);
  const searchEnd = Math.floor(targetW * 0.55);
  const yStart = Math.floor(targetH * 0.15);
  const yEnd = Math.floor(targetH * 0.85);
  const colHeight = yEnd - yStart;
  let bestX = center, bestScore = -Infinity;
  for (let x = searchStart; x < searchEnd; x++) {
    let sum = 0, sumSq = 0;
    for (let y = yStart; y < yEnd; y++) { const v = data[y * targetW + x]; sum += v; sumSq += v * v; }
    const mean = sum / colHeight;
    const variance = (sumSq / colHeight) - (mean * mean);
    const score = (255 - mean) * 2 + (100 / (1 + variance));
    if (score > bestScore) { bestScore = score; bestX = x; }
  }
  return bestX;
}

async function auditPage(imageUrl) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const ar = meta.width / meta.height;

  if (ar < 1.1) {
    return { type: 'single', ar, width: meta.width, height: meta.height };
  }

  // Gutter detection
  const targetW = 800;
  const scale = targetW / meta.width;
  const targetH = Math.round(meta.height * scale);
  const { data } = await sharp(buf).greyscale().resize(targetW, targetH).raw().toBuffer({ resolveWithObject: true });
  const gutterScaled = detectGutter(data, targetW, targetH);
  const gutterX = Math.round(gutterScaled / scale);

  const margin = 15;
  const leftWidth = gutterX - margin;
  const rightWidth = meta.width - gutterX - margin;
  const offsetPct = ((gutterX - meta.width / 2) / meta.width * 100);

  const warnings = [];
  if (Math.abs(offsetPct) > 5) warnings.push('large_offset');
  if (leftWidth / meta.width < 0.30) warnings.push('left_narrow');
  if (rightWidth / meta.width < 0.30) warnings.push('right_narrow');
  if (ar >= 1.1 && ar < 1.2) warnings.push('ambiguous_ar');

  return {
    type: 'spread',
    ar,
    width: meta.width,
    height: meta.height,
    gutterX,
    offsetPct: Math.round(offsetPct * 10) / 10,
    leftPct: Math.round(leftWidth / meta.width * 1000) / 10,
    rightPct: Math.round(rightWidth / meta.width * 1000) / 10,
    warnings,
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const query = { split_note: /AR gate.*portrait/, pages_count: { $gte: 10 } };
  const books = await db.collection('books').find(query, {
    projection: { id: 1, title: 1, display_title: 1, language: 1, pages_count: 1 }
  }).sort({ pages_count: -1 }).toArray();

  const total = LIMIT > 0 ? Math.min(LIMIT, books.length) : books.length;
  process.stderr.write(`Auditing ${total} books...\n`);

  const report = {
    timestamp: new Date().toISOString(),
    total_books: total,
    clean: 0,
    warnings: 0,
    errors: 0,
    all_single: 0,
    books: [],
  };

  for (let i = 0; i < total; i++) {
    const book = books[i];
    const bookResult = {
      id: book.id,
      title: (book.display_title || book.title)?.substring(0, 60),
      language: book.language,
      pages_count: book.pages_count,
      samples: [],
      status: 'clean',
      spread_count: 0,
      single_count: 0,
      warnings: [],
    };

    // Sample 10 pages evenly throughout the book
    const samplePositions = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]
      .map(p => Math.max(1, Math.floor(book.pages_count * p)))
      .filter((v, i, a) => a.indexOf(v) === i); // dedupe for small books
    const samplePages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $in: samplePositions } },
      { projection: { page_number: 1, archived_photo: 1 } }
    ).toArray();

    for (const page of samplePages) {
      if (!page.archived_photo) {
        bookResult.samples.push({ page: page.page_number, error: 'no_image' });
        continue;
      }

      try {
        const result = await auditPage(page.archived_photo);
        bookResult.samples.push({ page: page.page_number, ...result });
        if (result.type === 'spread') {
          bookResult.spread_count++;
          if (result.warnings.length > 0) {
            bookResult.warnings.push(...result.warnings.map(w => `p${page.page_number}: ${w}`));
          }
        } else {
          bookResult.single_count++;
        }
      } catch (e) {
        bookResult.samples.push({ page: page.page_number, error: e.message?.substring(0, 60) });
      }
    }

    if (bookResult.spread_count === 0 && bookResult.single_count > 0) {
      bookResult.status = 'all_single';
      report.all_single++;
    } else if (bookResult.warnings.length > 0) {
      bookResult.status = 'warning';
      report.warnings++;
    } else if (bookResult.spread_count > 0) {
      report.clean++;
    } else {
      bookResult.status = 'error';
      report.errors++;
    }

    report.books.push(bookResult);

    if ((i + 1) % 10 === 0) {
      process.stderr.write(`\r  ${i + 1}/${total} (${report.clean} clean, ${report.warnings} warn, ${report.all_single} single, ${report.errors} err)`);
    }
  }

  process.stderr.write(`\n\nDone.\n`);
  process.stderr.write(`Clean: ${report.clean}\n`);
  process.stderr.write(`Warnings: ${report.warnings}\n`);
  process.stderr.write(`All single: ${report.all_single}\n`);
  process.stderr.write(`Errors: ${report.errors}\n`);

  // Print warning details
  const warnBooks = report.books.filter(b => b.status === 'warning');
  if (warnBooks.length > 0) {
    process.stderr.write(`\n=== BOOKS WITH WARNINGS ===\n`);
    warnBooks.forEach(b => {
      process.stderr.write(`  ${b.id} ${b.language} "${b.title}" — ${b.warnings.join(', ')}\n`);
    });
  }

  const singleBooks = report.books.filter(b => b.status === 'all_single');
  if (singleBooks.length > 0) {
    process.stderr.write(`\n=== BOOKS THAT ARE ACTUALLY SINGLE PAGES ===\n`);
    singleBooks.forEach(b => {
      process.stderr.write(`  ${b.id} ${b.language} "${b.title}" (${b.pages_count}p)\n`);
    });
  }

  // JSON report to stdout
  console.log(JSON.stringify(report, null, 2));

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
