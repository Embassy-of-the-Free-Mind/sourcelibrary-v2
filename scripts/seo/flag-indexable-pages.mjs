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
 *
 * Usage:
 *   node scripts/seo/flag-indexable-pages.mjs --dry-run        # size only
 *   node scripts/seo/flag-indexable-pages.mjs                  # apply (read_count>=3)
 *   node scripts/seo/flag-indexable-pages.mjs --min-reads=5
 *   node scripts/seo/flag-indexable-pages.mjs --include-ft --ft-language=Latin
 *   node scripts/seo/flag-indexable-pages.mjs --clear          # revert
 */
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
  const b = await books.findOne({ id: bookId }, { projection: { _id: 0, slug: 1, visible: 1 } });
  const slug = b && b.visible !== false ? (b.slug || null) : null;
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

console.log(`\nScanned ${scanned} candidate pages:`);
console.log(`  qualified      : ${qualified.length}`);
console.log(`  skipped (thin) : ${skippedThin}`);
console.log(`  skipped (type) : ${skippedType}`);
console.log(`  skipped (slug) : ${skippedNoSlug} (hidden book / no slug)`);
if (FT_CAP > 0) console.log(`  skipped (cap)  : ${skippedCap}`);

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
const stale = await pages.find(
  { seo_indexable: true, id: { $nin: [...qualifiedIds] } },
  { projection: { _id: 0, id: 1 } }
).toArray();
if (stale.length) {
  const r = await pages.updateMany(
    { id: { $in: stale.map((s) => s.id) } },
    { $unset: { seo_indexable: '', seo_url: '' } }
  );
  console.log(`unset seo_indexable on ${r.modifiedCount} now-stale pages`);
}

const total = await pages.countDocuments({ seo_indexable: true });
console.log(`\nTotal indexable reader pages now: ${total}`);
await client.close();
