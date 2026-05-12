#!/usr/bin/env node
/**
 * Second-pass dedup: catches duplicate spread uploads that dHash missed
 * because of crop-width variation between scans.
 *
 * Signature: (page_type, <page-num> from OCR, same xStart-side: LEFT
 * if crop.xStart < 100, RIGHT if crop.xStart > 400). Two pages in the
 * same book with the same printed page-num and the same half-of-spread
 * are duplicates — even if their dHashes differ because of crop or scan
 * variation.
 *
 * Re-uses scripts/apply-spread-dedup.mjs's marking convention:
 *   - mark dupes with is_duplicate: true, duplicate_of, original_page_number,
 *     page_number → negative
 *   - renumber survivors 1..N
 *   - recompute counters
 *
 * Snapshot to .claude/docs/snapshots/dedup-pagenum-<book_id>.json.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-by-printed-page-num.mjs --dry-run
 *   node scripts/dedup-by-printed-page-num.mjs --book <id>
 *   node scripts/dedup-by-printed-page-num.mjs            # all 42 affected
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_BOOK = (() => {
  const i = args.indexOf('--book');
  return i !== -1 ? args[i + 1] : null;
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

function extractPrintedPageNum(ocrText) {
  if (!ocrText) return null;
  const m = ocrText.match(/<page-num>([^<]+)<\/page-num>/);
  if (!m) return null;
  const v = m[1].trim();
  if (!v || v === '-' || /^[A-Za-z]+$/.test(v)) return null; // skip pages with no usable number
  return v;
}

function halfOfSpread(crop) {
  if (!crop || typeof crop.xStart !== 'number') return null;
  if (crop.xStart < 100) return 'L';
  if (crop.xStart > 400) return 'R';
  return null;
}

function pageScore(p) {
  let s = 0;
  if (p.translation?.data) s += 10000;
  if (p.ocr?.data) s += 1000;
  const ocrLen = (p.ocr?.data || '').length;
  s += Math.min(ocrLen / 10000, 0.5);
  s -= (p.page_number || 99999);
  return s;
}

async function processBook(db, bookId, opts) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return null;
  const pages = await db.collection('pages').find(
    { book_id: bookId, page_number: { $gt: 0 } }
  ).sort({ page_number: 1 }).toArray();
  // Bucket by (page_type, printed_page_num, half_of_spread)
  const buckets = new Map();
  for (const p of pages) {
    const pn = extractPrintedPageNum(p.ocr?.data);
    if (!pn) continue;
    const half = halfOfSpread(p.crop);
    const key = `${p.page_type || '?'}|${pn}|${half || '?'}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  // Within each bucket, split into clusters where consecutive members are
  // within MAX_PAGE_DISTANCE of each other in digital page_number.
  // This avoids merging genuinely-different sections that happen to share
  // a printed page-num (e.g. start-of-each-tome page 1).
  const MAX_PAGE_DISTANCE = 8;
  const groups = [];
  for (const [key, ps] of buckets) {
    if (ps.length < 2) continue;
    const sorted = [...ps].sort((a, b) => a.page_number - b.page_number);
    let cluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].page_number - cluster[cluster.length - 1].page_number <= MAX_PAGE_DISTANCE) {
        cluster.push(sorted[i]);
      } else {
        if (cluster.length > 1) groups.push({ key, pages: cluster });
        cluster = [sorted[i]];
      }
    }
    if (cluster.length > 1) groups.push({ key, pages: cluster });
  }
  if (groups.length === 0) return { book_id: bookId, slug: book.slug, dup_groups: 0, dup_pages: 0 };

  // Pick canonicals
  const dupIds = [];
  const dupRedirect = new Map();
  for (const g of groups) {
    const sorted = [...g.pages].sort((a, b) => pageScore(b) - pageScore(a));
    const canonical = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      dupIds.push(sorted[i]._id);
      dupRedirect.set(String(sorted[i]._id), canonical._id);
    }
  }
  console.log(`${bookId} ${book.slug?.slice(0, 40).padEnd(40)} | ${groups.length} pagenum groups → ${dupIds.length} new dupes`);
  if (!opts.apply || dupIds.length === 0) return { book_id: bookId, slug: book.slug, dup_groups: groups.length, dup_pages: dupIds.length };

  // Snapshot
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `dedup-pagenum-${bookId}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  const allPages = await db.collection('pages').find({ book_id: bookId }).toArray();
  writeFileSync(snapPath, JSON.stringify({
    snapshot_date: new Date().toISOString(),
    book_id: bookId, slug: book.slug,
    pages_count_before: book.pages_count,
    pages: allPages,
    dup_ids: dupIds.map(String),
    dup_redirect: Object.fromEntries(dupRedirect),
  }, null, 2));

  // Mark dupes
  for (const dupId of dupIds) {
    const dup = pages.find(p => String(p._id) === String(dupId));
    if (!dup) continue;
    await db.collection('pages').updateOne(
      { _id: dup._id },
      { $set: {
          is_duplicate: true,
          duplicate_of: dupRedirect.get(String(dup._id)),
          original_page_number: dup.page_number,
          page_number: -Math.abs(dup.page_number),
          updated_at: new Date(),
        } }
    );
  }
  // Re-attribute gallery_images
  for (const [dupIdStr, canonicalId] of dupRedirect) {
    const dup = pages.find(p => String(p._id) === dupIdStr);
    const canonical = pages.find(p => String(p._id) === String(canonicalId));
    if (!dup || !canonical) continue;
    await db.collection('gallery_images').updateMany(
      { $or: [{ page_id: dup._id }, { page_id: dup.id }] },
      { $set: { page_id: canonical.id || canonical._id, page_number: canonical.page_number, updated_at: new Date() } }
    );
  }
  // Renumber survivors
  const survivors = await db.collection('pages').find(
    { book_id: bookId, page_number: { $gt: 0 } },
    { projection: { _id: 1, page_number: 1 } }
  ).sort({ page_number: 1 }).toArray();
  let i = 0;
  for (const s of survivors) {
    i++;
    if (s.page_number !== i) {
      await db.collection('pages').updateOne({ _id: s._id }, { $set: { page_number: i, updated_at: new Date() } });
    }
  }
  // Recompute counters
  const total = await db.collection('pages').countDocuments({ book_id: bookId, page_number: { $gt: 0 } });
  const ocr = await db.collection('pages').countDocuments({ book_id: bookId, page_number: { $gt: 0 }, 'ocr.data': { $exists: true, $ne: null } });
  const trans = await db.collection('pages').countDocuments({ book_id: bookId, page_number: { $gt: 0 }, 'translation.data': { $exists: true, $ne: null } });
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { pages_count: total, pages_ocr: ocr, pages_translated: trans, updated_at: new Date() } }
  );
  console.log(`  ✓ ${book.slug?.slice(0, 40).padEnd(40)} pages_count: ${book.pages_count} → ${total} (ocr=${ocr}, translated=${trans})`);
  return { book_id: bookId, slug: book.slug, before: book.pages_count, after: total, dup_groups: groups.length, dup_pages: dupIds.length };
}

async function main() {
  const auditPath = resolve(REPO_ROOT, '.claude/docs/bph-foreign-folder-pages-2026-05-12.json');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  let bookIds;
  if (SINGLE_BOOK) bookIds = [SINGLE_BOOK];
  else { bookIds = []; for (const o of audit) { bookIds.push(o.id); bookIds.push(o.sample_foreign_id); } }
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}. Books: ${bookIds.length}.`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const results = [];
  for (const id of bookIds) {
    const r = await processBook(db, id, { apply: !DRY_RUN });
    if (r) results.push(r);
  }
  const totalNew = results.reduce((s, r) => s + (r.dup_pages || 0), 0);
  const totalBefore = results.reduce((s, r) => s + (r.before || 0), 0);
  const totalAfter = results.reduce((s, r) => s + (r.after || 0), 0);
  console.log(`\nTotal: ${results.length} books, ${totalNew} new dupes ${DRY_RUN ? '(would be) ' : ''}marked.`);
  if (!DRY_RUN) console.log(`Total pages_count Δ: ${totalAfter - totalBefore}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
