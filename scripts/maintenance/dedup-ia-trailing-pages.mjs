#!/usr/bin/env node
/**
 * Detect and hide IA trailing-dupe pages.
 *
 * Background: IA's PDF-to-page extraction often emits a fixed-length run
 * of identical trailing pages — back-cover scans, IA wrapper templates,
 * blank fillers — that are BYTE-IDENTICAL on R2 (same content-length
 * proves it without downloading the image). These pages pollute the
 * reader (200 identical "blank back cover" entries in a 2333-page book),
 * waste OCR/translation budget, and inflate dashboard gaps.
 *
 * Strategy:
 *   For each IA book with ≥MIN_BOOK_PAGES archived pages:
 *     1. HEAD-probe the last WINDOW pages, collect content-length values
 *     2. Walk backward from the last page, count the longest run of
 *        identical content-length
 *     3. If the run ≥ MIN_RUN_LEN, mark all but the FIRST page of the run
 *        as duplicates by setting page_number = -<original_page_number>
 *        (per the atlas-search convention: hidden/deduped pages live at
 *        page_number ≤ 0). The first page in the run is preserved as the
 *        canonical "this is the back cover" entry.
 *     4. Decrement book.pages_count by (run_len - 1). Don't touch pageCount.
 *
 * Why byte-size and not dhash:
 *   IA's trash pages are generated from the same template — they hit R2
 *   with literally identical bytes. content-length match is exact, cheap
 *   (HEAD only, no image download), and doesn't require a new field on
 *   the pages collection. dhash is the right tool for near-duplicate
 *   gallery_images (PR #2095) but overkill for byte-exact page wrappers.
 *
 * Reversible: pages are hidden via negative page_number, never deleted.
 * To restore: set page_number back to its absolute value.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs                # dry-run, all IA books
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs --apply         # write changes
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs --book-id=XX    # single book
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs --limit=500     # cap books processed
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs --window=500    # deeper trailing scan
 *   node scripts/maintenance/dedup-ia-trailing-pages.mjs --min-run=10    # only hide runs ≥ N pages
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];
const BOOK_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const WINDOW = parseInt(process.argv.find(a => a.startsWith('--window='))?.split('=')[1] || '300', 10);
const MIN_RUN_LEN = parseInt(process.argv.find(a => a.startsWith('--min-run='))?.split('=')[1] || '5', 10);
const MIN_BOOK_PAGES = parseInt(process.argv.find(a => a.startsWith('--min-pages='))?.split('=')[1] || '20', 10);
const HEAD_CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--head-concurrency='))?.split('=')[1] || '20', 10);

async function head(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return r.status === 200 ? r.headers.get('content-length') : null;
  } catch { return null; }
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function pump() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, pump));
  return results;
}

async function findTrailingDupes(db, book) {
  const start = Math.max(1, book.pages_count - WINDOW + 1);
  const pages = await db.collection('pages')
    .find({ book_id: book.id, page_number: { $gte: start, $lte: book.pages_count } })
    .sort({ page_number: 1 })
    .project({ _id: 1, page_number: 1, archived_photo: 1 })
    .toArray();
  if (pages.length === 0) return null;

  const probes = pages.map(p => p.archived_photo?.startsWith('https://') ? p.archived_photo : null);
  const sizes = await runWithConcurrency(probes, u => u ? head(u) : null, HEAD_CONCURRENCY);

  // Walk backward from the last page, count longest run of identical content-length
  const lastSize = sizes[sizes.length - 1];
  if (!lastSize) return null;
  let runLen = 0;
  for (let i = sizes.length - 1; i >= 0 && sizes[i] === lastSize; i--) runLen++;
  if (runLen < MIN_RUN_LEN) return null;

  const runPages = pages.slice(pages.length - runLen);
  return {
    book,
    dupe_size: lastSize,
    run_len: runLen,
    canonical_page: runPages[0],          // keep this one
    dupes_to_hide: runPages.slice(1),     // hide these
    hit_window_edge: runLen >= pages.length,
  };
}

async function applyHide(db, dupes_to_hide) {
  if (dupes_to_hide.length === 0) return { matched: 0, modified: 0 };
  // Negate page_number on each dupe in one batched updateMany using $set per doc isn't possible
  // (updateMany sets the same value). Use bulkWrite to set each to its own -|n|.
  const ops = dupes_to_hide.map(p => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { page_number: -Math.abs(p.page_number), updated_at: new Date(), hidden_reason: 'ia_trailing_dupe' } },
    },
  }));
  const r = await db.collection('pages').bulkWrite(ops, { ordered: false });
  return { matched: r.matchedCount, modified: r.modifiedCount };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[dedup-ia-trailing] ${APPLY ? 'APPLY MODE — will write changes' : 'DRY RUN — no writes'}`);
  console.log(`  window=${WINDOW}, min_run=${MIN_RUN_LEN}, min_pages=${MIN_BOOK_PAGES}, concurrency=${HEAD_CONCURRENCY}`);

  const query = {
    'image_source.provider': 'internet_archive',
    visible: true,
    pages_count: { $gte: MIN_BOOK_PAGES },
  };
  if (BOOK_ID) query.id = BOOK_ID;

  const cursor = db.collection('books').find(query, {
    projection: { id: 1, title: 1, slug: 1, pages_count: 1, pageCount: 1 },
  }).sort({ pages_count: -1 });
  if (BOOK_LIMIT > 0) cursor.limit(BOOK_LIMIT);
  const books = await cursor.toArray();
  console.log(`  scanning ${books.length} books\n`);

  let booksWithDupes = 0;
  let totalHidden = 0;
  let edgeHits = 0;
  const stats = [];

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const result = await findTrailingDupes(db, b);
    if (!result) continue;

    booksWithDupes++;
    totalHidden += result.dupes_to_hide.length;
    if (result.hit_window_edge) edgeHits++;
    stats.push({ slug: b.slug, title: b.title, run_len: result.run_len, edge: result.hit_window_edge });

    const edgeNote = result.hit_window_edge ? ' ⚠️hit window edge' : '';
    console.log(`  [${i + 1}/${books.length}] ${b.title?.slice(0,50)}`);
    console.log(`        ${result.run_len} dupe pages at end (${result.dupe_size}B)${edgeNote}`);
    console.log(`        canonical: keep p${result.canonical_page.page_number}, hide p${result.dupes_to_hide[0]?.page_number}–p${result.dupes_to_hide[result.dupes_to_hide.length - 1]?.page_number}`);

    if (APPLY) {
      const hide = await applyHide(db, result.dupes_to_hide);
      await db.collection('books').updateOne(
        { id: b.id },
        { $inc: { pages_count: -(result.run_len - 1) }, $set: { updated_at: new Date() } }
      );
      console.log(`        applied: hid ${hide.modified} pages, decremented pages_count by ${result.run_len - 1}`);
    }
  }

  console.log(`\n[dedup-ia-trailing] Summary`);
  console.log(`  books scanned: ${books.length}`);
  console.log(`  books with dupes: ${booksWithDupes}`);
  console.log(`  pages ${APPLY ? 'hidden' : 'would be hidden'}: ${totalHidden}`);
  console.log(`  blocks hitting window edge (real count higher): ${edgeHits}  ${edgeHits > 0 ? '— re-run with --window=' + (WINDOW * 2) : ''}`);
  console.log(`  mode: ${APPLY ? 'APPLIED' : 'DRY-RUN (re-run with --apply to write)'}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
