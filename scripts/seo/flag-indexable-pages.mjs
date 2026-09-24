#!/usr/bin/env node
/**
 * SEO: flag demand-proven reader pages as indexable (issue #2688).
 *
 * Individual reader pages (`/book/<slug>/page/<pageId>`) are noindex by default
 * (see src/app/book/[id]/page/[pageId]/layout.tsx). This script opens up the
 * *demand-proven* subset: pages humans actually read, plus — optionally — the
 * uncontested first-translation long tail.
 *
 * It writes `seo_indexable: true` + `seo_url` onto qualifying `pages` docs.
 * The render gate (layout generateMetadata) and the sitemap both read those
 * fields. Fully reversible: `--clear` unsets the flag everywhere.
 *
 * Eligibility (a page must have substantial text AND one of):
 *   - pages.read_count >= MIN_READS — the *all-time* human read counter
 *     (incremented by /api/analytics/track on page_read; populated for
 *     anonymous main-site readers, not just editors — verified 99.9% coverage
 *     on the read-proven set). Unlike analytics_pageviews (90d TTL), this never
 *     ages out, so the indexable set is stable and needs no refresh cron.
 *   - (--include-ft) the book is is_first_translation + translated and the
 *     page itself is translated. This arm is ~1.4M pages — OFF by default;
 *     ramp it deliberately (--ft-language=Latin, --ft-cap=N per book).
 *   - (--include-quality) issue #3755: the ordinary case the demand arm can
 *     never reach (a page cannot accumulate reads while it is invisible to
 *     search). The first --quality-cap translated pages (default 25) of every
 *     visible, translated book with >= --min-ocr-pct OCR coverage (default
 *     95), where the translation is at least --min-translation-chars long
 *     (default 300 — excludes blank-leaf placeholders and fragments). The cap
 *     is the crawl-budget lever; raise it only on Search Console evidence.
 *
 * Every arm skips books on pipeline hold (`pipeline_auto.hold` — their text is
 * known to be misaligned) and any book id listed in --exclude-books=<file>
 * (one id per line; used for the private rights-screen list, which never
 * enters this repo). A page withheld by the stale-translation sweep has no
 * `translation.data`, so it cannot qualify through the translation arms.
 *
 * Usage:
 *   node scripts/seo/flag-indexable-pages.mjs --dry-run        # size only
 *   node scripts/seo/flag-indexable-pages.mjs                  # apply (read_count>=3)
 *   node scripts/seo/flag-indexable-pages.mjs --min-reads=5
 *   node scripts/seo/flag-indexable-pages.mjs --include-ft --ft-language=Latin
 *   node scripts/seo/flag-indexable-pages.mjs --include-quality --quality-cap=25 --exclude-books=<file> --no-reconcile
 *   node scripts/seo/flag-indexable-pages.mjs --clear          # revert
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.split('=')[1] : d;
};

const DRY_RUN = has('--dry-run');
const CLEAR = has('--clear');
const MIN_READS = parseInt(val('--min-reads', '3'), 10);
const INCLUDE_FT = has('--include-ft');
const FT_LANGUAGE = val('--ft-language', null); // restrict FT arm to one language
const FT_CAP = parseInt(val('--ft-cap', '0'), 10); // 0 = no per-book cap
const INCLUDE_QUALITY = has('--include-quality');
const QUALITY_CAP = parseInt(val('--quality-cap', '25'), 10);
const MIN_OCR_PCT = parseFloat(val('--min-ocr-pct', '95'));
const MIN_TRANSLATION_CHARS = parseInt(val('--min-translation-chars', '300'), 10);
// Additive run: set flags, never unset. Use when the options that produced the
// currently-flagged set are not being reproduced in this run — reconcile would
// otherwise unflag every page an omitted arm had opened.
const NO_RECONCILE = has('--no-reconcile');
const EXCLUDE_FILE = val('--exclude-books', null);
const excludedBooks = new Set(
  EXCLUDE_FILE
    ? readFileSync(EXCLUDE_FILE, 'utf8').split(/\s+/).map((x) => x.trim()).filter(Boolean)
    : []
);
if (EXCLUDE_FILE) console.log(`Excluding ${excludedBooks.size} book ids from ${EXCLUDE_FILE}`);

// A page needs real text to be worth indexing — never open blank/thin scans.
const MIN_OCR_CHARS = 120;
function hasSubstantialText(page) {
  const t = (page.translation?.data || '').trim();
  if (t.length > 0) return true;
  const o = (page.ocr?.data || '').trim();
  return o.length >= MIN_OCR_CHARS;
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set — run with: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');
const books = db.collection('books');

// Partial index on the flag — without it, the reconcile `$nin` below and the
// sitemap's count/find on seo_indexable full-scan the millions-row pages
// collection. Compound on _id so the sitemap's `sort({_id:1})` paginated
// query is served by the index (a single-field {seo_indexable:1} index makes
// the planner full-scan in _id order to satisfy the sort → timeout → empty
// page chunks). Idempotent; only indexes the ~tens-of-thousands flagged docs.
await pages.createIndex(
  { seo_indexable: 1, _id: 1 },
  { partialFilterExpression: { seo_indexable: true }, name: 'seo_indexable_id_partial' }
);
// Partial index on the read counter so Arm 1's candidate query doesn't
// full-scan the millions-row pages collection (an unindexed count/find here
// times out). Filter is constant at 3 (our default floor); --min-reads below 3
// falls back to a scan, which is fine for an occasional manual run.
if (!CLEAR) {
  await pages.createIndex(
    { read_count: 1 },
    { partialFilterExpression: { read_count: { $gte: 3 } }, name: 'read_count_ge3_partial' }
  );
}

if (CLEAR) {
  const before = await pages.countDocuments({ seo_indexable: true });
  if (DRY_RUN) {
    console.log(`[dry-run] would clear seo_indexable on ${before} pages`);
  } else {
    const r = await pages.updateMany(
      { seo_indexable: true },
      { $unset: { seo_indexable: '', seo_url: '' } }
    );
    console.log(`cleared seo_indexable on ${r.modifiedCount} pages (was ${before})`);
  }
  await client.close();
  process.exit(0);
}

// --- Arm 1: demand (pages.read_count — all-time human reads) ---
// No analytics window: read_count accumulates for the life of the page, so the
// indexable set is stable. The candidate query below matches it directly.
console.log(`Arm 1 — readership: pages with all-time read_count >= ${MIN_READS}`);

// --- Arm 2 (optional): first-translation long tail ---
let ftBookIds = new Set();
if (INCLUDE_FT) {
  const ftMatch = { is_first_translation: true, pages_translated: { $gt: 0 }, visible: true };
  if (FT_LANGUAGE) ftMatch.language = FT_LANGUAGE;
  const ftBooks = await books.find(ftMatch, { projection: { id: 1 } }).toArray();
  ftBookIds = new Set(ftBooks.map((b) => b.id).filter(Boolean));
  console.log(`Arm 2 — first-translations${FT_LANGUAGE ? ` (${FT_LANGUAGE})` : ''}: ${ftBookIds.size} books`);
}

// Resolve book slugs (needed for seo_url) for every candidate book.
// Gather candidate book_ids: from read pages we don't know book_id yet, so we
// stream the pages and look up slugs as we go (cached).
const slugCache = new Map(); // book_id -> slug | null
async function slugFor(bookId) {
  if (slugCache.has(bookId)) return slugCache.get(bookId);
  const b = await books.findOne({ id: bookId }, { projection: { _id: 0, slug: 1, visible: 1, 'pipeline_auto.hold': 1 } });
  const eligible = b && b.visible !== false && !b.pipeline_auto?.hold && !excludedBooks.has(bookId);
  const slug = eligible ? (b.slug || null) : null;
  slugCache.set(bookId, slug);
  return slug;
}

// Build the qualifying set by streaming candidate pages.
// Candidates = pages with read_count >= MIN_READS, OR (FT) book_id in ftBookIds.
const orClauses = [{ read_count: { $gte: MIN_READS } }];
if (ftBookIds.size) orClauses.push({ book_id: { $in: [...ftBookIds] }, 'translation.data': { $exists: true, $ne: '' } });

const cursor = pages.find(
  { $or: orClauses, page_number: { $gte: 0 } },
  { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, read_count: 1, 'translation.data': 1, 'ocr.data': 1 } }
).batchSize(500);

const ftPerBook = new Map(); // book_id -> count (for --ft-cap)
const qualified = []; // { id, seo_url }
let scanned = 0, skippedThin = 0, skippedNoSlug = 0, skippedType = 0, skippedCap = 0;

for await (const page of cursor) {
  scanned++;
  if (page.page_type === 'digitizer-insert' || page.page_type === 'archived-spread') { skippedType++; continue; }
  if (!hasSubstantialText(page)) { skippedThin++; continue; }

  const viaRead = (page.read_count || 0) >= MIN_READS;
  const viaFt = ftBookIds.has(page.book_id) && (page.translation?.data || '').trim().length > 0;
  if (!viaRead && !viaFt) continue;

  // per-book cap applies to the FT arm only (read-proven pages always qualify)
  if (!viaRead && viaFt && FT_CAP > 0) {
    const n = ftPerBook.get(page.book_id) || 0;
    if (n >= FT_CAP) { skippedCap++; continue; }
    ftPerBook.set(page.book_id, n + 1);
  }

  const slug = await slugFor(page.book_id);
  if (!slug) { skippedNoSlug++; continue; }

  qualified.push({ id: page.id, seo_url: `/book/${slug}/page/${page.id}` });
}

// --- Arm 3 (optional): quality — first N translated pages of well-OCR'd books (#3755) ---
// Per-book aggregation on the {book_id, page_number} index; lengths are computed
// server-side so no page text crosses the wire.
let qualityBooks = 0, qualityAdded = 0;
if (INCLUDE_QUALITY) {
  const seen = new Set(qualified.map((q) => q.id));
  const candidates = (await books.find(
    {
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      slug: { $type: 'string', $ne: '' },
      'pipeline_auto.hold': { $exists: false },
    },
    { projection: { _id: 0, id: 1, slug: 1, pages_count: 1, pages_ocr: 1 } }
  ).toArray()).filter((b) =>
    b.id && !excludedBooks.has(b.id) && ((b.pages_ocr || 0) / b.pages_count) * 100 >= MIN_OCR_PCT
  );
  console.log(`Arm 3 — quality: ${candidates.length} books (>= ${MIN_OCR_PCT}% OCR), cap ${QUALITY_CAP}/book, translation >= ${MIN_TRANSLATION_CHARS} chars`);

  const CONCURRENCY = 8;
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const b = candidates[next++];
      const rows = await pages.aggregate([
        { $match: { book_id: b.id, page_number: { $gte: 0 }, 'translation.data': { $type: 'string' } } },
        { $sort: { page_number: 1 } },
        { $project: { _id: 0, id: 1, page_type: 1, tlen: { $strLenCP: { $trim: { input: '$translation.data' } } } } },
        { $match: { tlen: { $gte: MIN_TRANSLATION_CHARS }, page_type: { $nin: ['digitizer-insert', 'archived-spread'] } } },
        { $limit: QUALITY_CAP },
      ]).toArray();
      if (rows.length) qualityBooks++;
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        qualified.push({ id: r.id, seo_url: `/book/${b.slug}/page/${r.id}` });
        qualityAdded++;
      }
      if (next % 1000 === 0) console.log(`  quality arm: ${next}/${candidates.length} books, ${qualityAdded} pages`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

console.log(`\nScanned ${scanned} candidate pages:`);
console.log(`  qualified      : ${qualified.length}`);
console.log(`  skipped (thin) : ${skippedThin}`);
console.log(`  skipped (type) : ${skippedType}`);
console.log(`  skipped (slug) : ${skippedNoSlug} (hidden book / no slug)`);
if (FT_CAP > 0) console.log(`  skipped (cap)  : ${skippedCap}`);
if (INCLUDE_QUALITY) console.log(`  quality arm    : +${qualityAdded} pages from ${qualityBooks} books`);

if (DRY_RUN) {
  console.log('\n[dry-run] no writes. Sample:');
  for (const q of qualified.slice(0, 10)) console.log('   ', q.seo_url);
  await client.close();
  process.exit(0);
}

// Apply: set the flag on qualifying pages, unset on pages that no longer qualify.
const qualifiedIds = new Set(qualified.map((q) => q.id));

let modified = 0;
const BATCH = 1000;
for (let i = 0; i < qualified.length; i += BATCH) {
  const slice = qualified.slice(i, i + BATCH);
  const ops = slice.map((q) => ({
    updateOne: {
      filter: { id: q.id },
      update: { $set: { seo_indexable: true, seo_url: q.seo_url } },
    },
  }));
  const r = await pages.bulkWrite(ops, { ordered: false });
  modified += r.modifiedCount;
}
console.log(`\nset seo_indexable on ${qualified.length} pages (${modified} newly modified)`);

// Reconcile: drop the flag from previously-flagged pages that fell out of the set.
// Diffed here rather than with `id: {$nin: [...]}` — at hundreds of thousands
// of ids that query document approaches Mongo's 16MB BSON limit. The partial
// index makes streaming the flagged ids cheap.
const stale = [];
if (!NO_RECONCILE) for await (const p of pages.find({ seo_indexable: true }, { projection: { _id: 0, id: 1 } })) {
  if (!qualifiedIds.has(p.id)) stale.push(p.id);
}
let unset = 0;
for (let i = 0; i < stale.length; i += BATCH) {
  const r = await pages.updateMany(
    { id: { $in: stale.slice(i, i + BATCH) } },
    { $unset: { seo_indexable: '', seo_url: '' } }
  );
  unset += r.modifiedCount;
}
if (stale.length) console.log(`unset seo_indexable on ${unset} now-stale pages (of ${stale.length})`);

const total = await pages.countDocuments({ seo_indexable: true });
console.log(`\nTotal indexable reader pages now: ${total}`);
await client.close();
