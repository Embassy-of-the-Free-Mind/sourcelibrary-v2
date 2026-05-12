#!/usr/bin/env node
/**
 * Apply spread-upload dedup using the pHash scan results from
 * scripts/dedup-spread-uploads.mjs (#1721).
 *
 * For each duplicate group (cluster of pages with near-identical dHash):
 *   1. Pick a canonical page: prefer (has translation, has OCR, longest OCR,
 *      lowest page_number).
 *   2. Mark every other page in the group with:
 *        - is_duplicate: true
 *        - duplicate_of: <canonical._id>
 *        - original_page_number: <current page_number>
 *        - page_number: -1 * |current| (negative pulls it out of the
 *          user-visible page sequence, same convention as archived-spread)
 *   3. Re-attribute gallery_images whose page_id is a non-canonical dup
 *      → point them at the canonical page instead.
 *   4. Renumber surviving pages (page_number > 0) sequentially 1..N to
 *      close the gaps.
 *   5. Recompute pages_count / pages_ocr / pages_translated.
 *
 * Snapshot of every affected book + pages saved before any write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/apply-spread-dedup.mjs --dry-run   # preview
 *   node scripts/apply-spread-dedup.mjs             # apply all
 *   node scripts/apply-spread-dedup.mjs --book <id> # one book
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
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

function pageScore(p) {
  // Prefer the LOWEST page_number in a group. This keeps both halves of a
  // single spread upload together (left-half and right-half of upload A,
  // not left of A + right of B), which preserves physical reading order.
  // Quality only overrides when one page is materially worse (missing
  // OCR or translation when another has it).
  let s = 0;
  if (p.translation?.data) s += 10000;          // big: missing translation is a dealbreaker
  if (p.ocr?.data) s += 1000;                    // big: missing OCR is a dealbreaker
  // Tiny OCR-length nudge — only matters between two pages with the same has-OCR/translation state
  const ocrLen = (p.ocr?.data || '').length;
  s += Math.min(ocrLen / 10000, 0.5);
  // Strong preference for lower page_number (first upload in the duplicated batch)
  s -= (p.page_number || 99999);
  return s;
}

async function applyForBook(db, bookData, opts = {}) {
  const { book_id, dup_groups, groups } = bookData;
  if (dup_groups === 0) return null;
  const book = await db.collection('books').findOne({ id: book_id });
  if (!book) {
    console.log(`  SKIP book not found: ${book_id}`);
    return null;
  }
  // Fetch full docs for all candidate pages, by page_number lookup.
  // (We trust the scan's groups to be correctly clustered; each page in a
  //  group should still exist on the same book_id.)
  const allPageNums = groups.flatMap(g => g.map(p => p.page_number));
  const candidatePages = await db.collection('pages').find(
    { book_id, page_number: { $in: allPageNums } }
  ).toArray();
  const byPageNum = new Map();
  for (const p of candidatePages) byPageNum.set(p.page_number, p);

  // Pick canonical + collect dupes per group.
  const dupIds = []; // _id of pages to mark as duplicates
  const dupRedirect = new Map(); // dupId → canonicalId
  let groupsResolved = 0;
  for (const g of groups) {
    const pages = g.map(p => byPageNum.get(p.page_number)).filter(Boolean);
    if (pages.length < 2) continue;
    pages.sort((a, b) => pageScore(b) - pageScore(a));
    const canonical = pages[0];
    for (let i = 1; i < pages.length; i++) {
      dupIds.push(pages[i]._id);
      dupRedirect.set(String(pages[i]._id), canonical._id);
    }
    groupsResolved++;
  }

  console.log(`${book_id} ${book.slug?.slice(0, 40).padEnd(40)} | ${groupsResolved} groups → ${dupIds.length} dupes`);

  if (!opts.apply) return { book_id, dupIds: dupIds.length };

  // Snapshot
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `dedup-${book_id}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  const allPages = await db.collection('pages').find({ book_id }).toArray();
  writeFileSync(snapPath, JSON.stringify({
    snapshot_date: new Date().toISOString(),
    book_id, slug: book.slug,
    pages_count_before: book.pages_count,
    pages: allPages,
    dup_ids: dupIds.map(String),
    dup_redirect: Object.fromEntries(dupRedirect),
  }, null, 2));

  // 1. Mark duplicates: set is_duplicate, duplicate_of, original_page_number, negative page_number
  for (const dupId of dupIds) {
    const dup = candidatePages.find(p => String(p._id) === String(dupId));
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

  // 2. Re-attribute gallery_images whose page_id is a duplicate.
  for (const [dupIdStr, canonicalId] of dupRedirect) {
    // page_id could be _id (ObjectId-as-string) or id (separate hex string)
    const dupPage = candidatePages.find(p => String(p._id) === dupIdStr);
    const canonicalPage = candidatePages.find(p => String(p._id) === String(canonicalId));
    if (!dupPage || !canonicalPage) continue;
    // Find gallery_images linked to either form of the dup page's id
    const filter = { $or: [{ page_id: dupPage._id }, { page_id: dupPage.id }] };
    const galleryImgs = await db.collection('gallery_images').find(filter).toArray();
    for (const ga of galleryImgs) {
      await db.collection('gallery_images').updateOne(
        { _id: ga._id },
        { $set: {
            page_id: canonicalPage.id || canonicalPage._id,
            page_number: canonicalPage.page_number,
            updated_at: new Date(),
          } }
      );
    }
  }

  // 3. Renumber survivors: pages with page_number > 0 → 1..N by current page_number order.
  const survivors = await db.collection('pages').find(
    { book_id, page_number: { $gt: 0 } },
    { projection: { _id: 1, page_number: 1 } }
  ).sort({ page_number: 1 }).toArray();
  let i = 0;
  for (const s of survivors) {
    i++;
    if (s.page_number !== i) {
      await db.collection('pages').updateOne(
        { _id: s._id },
        { $set: { page_number: i, updated_at: new Date() } }
      );
    }
  }

  // 4. Recompute counters
  const total = await db.collection('pages').countDocuments({ book_id, page_number: { $gt: 0 } });
  const ocr = await db.collection('pages').countDocuments({ book_id, page_number: { $gt: 0 }, 'ocr.data': { $exists: true, $ne: null } });
  const trans = await db.collection('pages').countDocuments({ book_id, page_number: { $gt: 0 }, 'translation.data': { $exists: true, $ne: null } });
  await db.collection('books').updateOne(
    { id: book_id },
    { $set: { pages_count: total, pages_ocr: ocr, pages_translated: trans, updated_at: new Date() } }
  );
  console.log(`  ✓ ${book.slug?.slice(0, 40).padEnd(40)} pages_count: ${book.pages_count} → ${total} (ocr=${ocr}, translated=${trans})`);
  return { book_id, slug: book.slug, before: book.pages_count, after: total, dupes_marked: dupIds.length, gallery_reattribute: dupRedirect.size };
}

async function main() {
  const scanPath = resolve(REPO_ROOT, '.claude/docs/bph-duplicate-spread-uploads-2026-05-12.json');
  const scan = JSON.parse(readFileSync(scanPath, 'utf8'));

  let books = scan.books.filter(b => b.dup_groups > 0);
  if (SINGLE_BOOK) books = books.filter(b => b.book_id === SINGLE_BOOK);

  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Books to dedup: ${books.length} (of ${scan.books.length} scanned)`);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 600000 });
  await client.connect();
  const db = client.db('bookstore');

  const results = [];
  for (const b of books) {
    const r = await applyForBook(db, b, { apply: !DRY_RUN });
    if (r) results.push(r);
  }

  const totalBefore = results.reduce((s, r) => s + (r.before || 0), 0);
  const totalAfter = results.reduce((s, r) => s + (r.after || 0), 0);
  const totalDupes = results.reduce((s, r) => s + (r.dupes_marked || r.dupIds || 0), 0);
  console.log(`\nTotal: ${results.length} books, ${totalDupes} dupes ${DRY_RUN ? '(would be) ' : ''}marked.`);
  if (!DRY_RUN) console.log(`Total pages_count: ${totalBefore} → ${totalAfter} (Δ ${totalAfter - totalBefore})`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
