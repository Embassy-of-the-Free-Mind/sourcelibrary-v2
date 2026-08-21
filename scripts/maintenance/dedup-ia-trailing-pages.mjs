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
 *     3. If the run ≥ MIN_RUN_LEN, hide the entire trailing duplicate run by
 *        setting page_number = -<original_page_number> for every matched page
 *        (per the atlas-search convention: hidden/deduped pages live at
 *        page_number ≤ 0). The page immediately before the run is preserved as
 *        the visible keep page.
 *     4. Decrement book.pages_count by run_len. (The camelCase `pageCount`
 *        twin this once avoided was retired in #3969 — nothing read it, and on
 *        186 books it held a stale PRE-SPLIT count, roughly half the truth.)
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
import { DEFAULT_OPTS, findTrailingDupes, applyHide } from '../workers/lib/trailing-dedup.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];
const PROVIDER = process.argv.find(a => a.startsWith('--provider='))?.split('=')[1]; // optional filter
const BOOK_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
// Detection tuning — CLI overrides over DEFAULT_OPTS (shared with the
// orchestrator's Phase 1.97). The auto-expand loop doubles the lookback each
// time the run covers the whole probed batch, so a 200+ dupe block is still
// fully caught — just iteratively.
const WINDOW = parseInt(process.argv.find(a => a.startsWith('--window='))?.split('=')[1] || '', 10) || DEFAULT_OPTS.window;
const MIN_RUN_LEN = parseInt(process.argv.find(a => a.startsWith('--min-run='))?.split('=')[1] || '', 10) || DEFAULT_OPTS.minRunLen;
const MIN_BOOK_PAGES = parseInt(process.argv.find(a => a.startsWith('--min-pages='))?.split('=')[1] || '', 10) || DEFAULT_OPTS.minBookPages;
const HEAD_CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--head-concurrency='))?.split('=')[1] || '', 10) || DEFAULT_OPTS.headConcurrency;
const MAX_EXPANSIONS = parseInt(process.argv.find(a => a.startsWith('--max-expansions='))?.split('=')[1] || '', 10) || DEFAULT_OPTS.maxExpansions;

// Detection opts passed to the shared findTrailingDupes on every call.
const DEDUP_OPTS = {
  window: WINDOW,
  minRunLen: MIN_RUN_LEN,
  minBookPages: MIN_BOOK_PAGES,
  headConcurrency: HEAD_CONCURRENCY,
  maxExpansions: MAX_EXPANSIONS,
};

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[dedup-ia-trailing] ${APPLY ? 'APPLY MODE — will write changes' : 'DRY RUN — no writes'}`);
  console.log(`  window=${WINDOW}, min_run=${MIN_RUN_LEN}, min_pages=${MIN_BOOK_PAGES}, concurrency=${HEAD_CONCURRENCY}`);

  // Run on ALL books with archived pages — the trailing-dupe pattern is
  // upstream-library-agnostic. Vision spot-check found BSB/MDZ books with
  // the same artifact (library metadata page repeated), not just IA.
  const query = {
    visible: true,
    pages_count: { $gte: MIN_BOOK_PAGES },
  };
  if (BOOK_ID) query.id = BOOK_ID;
  if (PROVIDER) query['image_source.provider'] = PROVIDER;

  const cursor = db.collection('books').find(query, {
    projection: { id: 1, title: 1, slug: 1, pages_count: 1 },
  }).sort({ pages_count: -1 });
  if (BOOK_LIMIT > 0) cursor.limit(BOOK_LIMIT);
  const books = await cursor.toArray();
  console.log(`  scanning ${books.length} books\n`);

  let booksWithDupes = 0;
  let totalHidden = 0;
  let suspiciouslyDeep = 0;
  const stats = [];

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const result = await findTrailingDupes(db, b, DEDUP_OPTS);
    if (!result) continue;

    booksWithDupes++;
    totalHidden += result.dupes_to_hide.length;
    if (result.hit_book_start) suspiciouslyDeep++;
    stats.push({ slug: b.slug, title: b.title, run_len: result.run_len, hit_book_start: result.hit_book_start });

    // If the dupe block extends all the way to page 1, the entire book is one
    // repeated image — unusual and worth a hand-check before applying.
    const startNote = result.hit_book_start ? ' ⚠️dupe block reaches page 1 — likely entire book is one image, SKIP-WORTHY' : '';
    console.log(`  [${i + 1}/${books.length}] ${b.title?.slice(0,50)}`);
    console.log(`        ${result.run_len} dupe pages at end (etag=${result.dupe_etag.slice(0, 10)})${startNote}`);
    console.log(`        canonical: keep p${result.canonical_page?.page_number ?? '(none)'}, hide p${result.dupes_to_hide[0]?.page_number}–p${result.dupes_to_hide[result.dupes_to_hide.length - 1]?.page_number}`);

    if (APPLY && !result.hit_book_start) {
      const hide = await applyHide(db, result.dupes_to_hide);
      await db.collection('books').updateOne(
        { id: b.id },
        { $inc: { pages_count: -result.run_len }, $set: { updated_at: new Date() } }
      );
      console.log(`        applied: hid ${hide.modified} pages, decremented pages_count by ${result.run_len}`);
    } else if (APPLY && result.hit_book_start) {
      console.log(`        SKIPPED (hit book start — needs hand review)`);
    }
  }

  console.log(`\n[dedup-trailing-pages] Summary`);
  console.log(`  books scanned: ${books.length}`);
  console.log(`  books with dupes: ${booksWithDupes}`);
  console.log(`  pages ${APPLY ? 'hidden' : 'would be hidden'}: ${totalHidden}`);
  console.log(`  books where dupe block reaches page 1 (suspicious, skipped on --apply): ${suspiciouslyDeep}`);
  console.log(`  mode: ${APPLY ? 'APPLIED' : 'DRY-RUN (re-run with --apply to write)'}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
