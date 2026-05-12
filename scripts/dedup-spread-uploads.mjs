#!/usr/bin/env node
/**
 * Detect duplicate spread uploads in the 42 BPH books touched by #1713,
 * using a perceptual hash (dHash) on each page's cropped_photo image.
 *
 * dHash: resize to 9x8 grayscale, compute 64-bit fingerprint from
 * horizontal pixel differences. Two images with Hamming distance ≤ 5
 * (≈ 92% bit similarity) are flagged as duplicates.
 *
 * For each book, walks every page (in parallel batches), fetches the
 * cropped_photo, hashes it, and groups by hash. Outputs duplicate
 * clusters to .claude/docs/bph-duplicate-spread-uploads-2026-05-12.json.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-spread-uploads.mjs                     # all 42
 *   node scripts/dedup-spread-uploads.mjs --book <id>         # single
 *   node scripts/dedup-spread-uploads.mjs --concurrency 16
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const SINGLE_BOOK = (() => {
  const i = args.indexOf('--book');
  return i !== -1 ? args[i + 1] : null;
})();
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i !== -1 ? parseInt(args[i + 1], 10) : 16;
})();
const HAMMING_THRESHOLD = 2;     // strict — distance ≤ 2 ≈ 97% bit similarity
const MAX_PAGE_DISTANCE = 8;     // only cluster pages near each other in the sorted sequence
                                  // (real dup uploads land adjacent after upload-order sort;
                                  //  this filters out incidental dHash collisions in repeated layouts)

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

// --- dHash (9x8 grayscale, horizontal differences → 64 bits) ---
async function dhash(buffer) {
  const raw = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  // raw is 9*8 = 72 bytes, row-major
  let hash = 0n;
  let bit = 63n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = raw[y * 9 + x];
      const right = raw[y * 9 + x + 1];
      if (left < right) hash |= (1n << bit);
      bit--;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

function hammingDistance(a, b) {
  // a, b are 16-hex strings (64 bits)
  let aBig = BigInt('0x' + a);
  let bBig = BigInt('0x' + b);
  let x = aBig ^ bBig;
  let count = 0;
  while (x) {
    if (x & 1n) count++;
    x >>= 1n;
  }
  return count;
}

async function fetchWithTimeout(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function parallelMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function scanBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, slug: 1, title: 1, pages_count: 1 } });
  if (!book) return null;
  const pages = await db.collection('pages').find(
    { book_id: bookId, cropped_photo: { $exists: true, $ne: null } },
    { projection: { _id: 1, page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1 } }
  ).sort({ page_number: 1 }).toArray();
  const startedAt = Date.now();
  const results = await parallelMap(pages, async (p) => {
    try {
      const buf = await fetchWithTimeout(p.cropped_photo, 20000);
      const h = await dhash(buf);
      return { page_number: p.page_number, page_type: p.page_type, hash: h, cropped: p.cropped_photo };
    } catch (e) {
      return { page_number: p.page_number, page_type: p.page_type, hash: null, error: e.message };
    }
  }, CONCURRENCY);
  // Cluster by hash with Hamming ≤ threshold
  const valid = results.filter(r => r.hash);
  const groups = [];
  const assigned = new Set();
  for (let i = 0; i < valid.length; i++) {
    if (assigned.has(i)) continue;
    const group = [valid[i]];
    assigned.add(i);
    for (let j = i + 1; j < valid.length; j++) {
      if (assigned.has(j)) continue;
      if (valid[i].page_type !== valid[j].page_type) continue;
      if (Math.abs(valid[i].page_number - valid[j].page_number) > MAX_PAGE_DISTANCE) continue;
      if (hammingDistance(valid[i].hash, valid[j].hash) <= HAMMING_THRESHOLD) {
        group.push(valid[j]);
        assigned.add(j);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const failed = results.filter(r => !r.hash).length;
  const dupPages = groups.reduce((s, g) => s + g.length - 1, 0);
  console.log(`${bookId} ${book.slug?.slice(0, 40).padEnd(40)} ${pages.length}p, ${groups.length} dup groups, ${dupPages} dup pages, ${failed} failed (${elapsed}s)`);
  return { book_id: bookId, slug: book.slug, title: book.title, pages_count: book.pages_count, scanned: pages.length, failed, dup_groups: groups.length, dup_pages: dupPages, groups };
}

async function main() {
  const auditPath = resolve(REPO_ROOT, '.claude/docs/bph-foreign-folder-pages-2026-05-12.json');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));

  let bookIds;
  if (SINGLE_BOOK) {
    bookIds = [SINGLE_BOOK];
  } else {
    bookIds = [];
    for (const o of audit) { bookIds.push(o.id); bookIds.push(o.sample_foreign_id); }
  }
  console.log(`Scanning ${bookIds.length} books, concurrency=${CONCURRENCY}, hamming threshold=${HAMMING_THRESHOLD}.`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const all = [];
  for (const id of bookIds) {
    const r = await scanBook(db, id);
    if (r) all.push(r);
  }
  await client.close();

  const totalDupPages = all.reduce((s, b) => s + b.dup_pages, 0);
  const totalGroups = all.reduce((s, b) => s + b.dup_groups, 0);
  console.log(`\nTotal: ${all.length} books, ${totalGroups} dup groups, ${totalDupPages} dup pages.`);

  const outPath = resolve(REPO_ROOT, '.claude/docs/bph-duplicate-spread-uploads-2026-05-12.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    scan_date: new Date().toISOString(),
    hamming_threshold: HAMMING_THRESHOLD,
    total_books: all.length,
    total_dup_groups: totalGroups,
    total_dup_pages: totalDupPages,
    books: all,
  }, null, 2));
  console.log(`Saved: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
