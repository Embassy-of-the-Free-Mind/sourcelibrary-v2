#!/usr/bin/env node
/**
 * Standing detector: books whose Mongo `collections` array disagrees with the
 * Supabase `books_catalog.collections` mirror the collection grid reads.
 *
 * WHY (#4399). A collection page's works grid is served from Supabase —
 * `browseBooks()` does `.contains('collections', [slug])` on `books_catalog`,
 * filtered to `visible = true AND pages_count > 0`. The mirror is filled by
 * `scripts/workers/sync-books-catalog.mjs`, which runs INCREMENTALLY over
 * `{ updated_at: { $gt: lastSync } }`. Until #4399, every `$addToSet` /`$pull`
 * of `books.collections` in `src/` left `updated_at` alone, so the tag never
 * reached the mirror and the grid rendered empty — which reads as "we hold
 * nothing", not as "the mirror never ran".
 *
 * The write side is now guarded (`src/lib/collection-tagging.ts` +
 * `tests/unit/collection-tagging.test.ts`). This is the READ-side check, and it
 * also catches rows stranded by a sync tick that failed mid-batch
 * (`.claude/docs/supabase.md:136`) — a class of drift no write guard can see.
 *
 * READ-ONLY. It repairs nothing; the repair is a `--full` sync or a targeted
 * `updated_at` bump, and that is a human decision.
 *
 * Exit 0 = no drift, 1 = drift found, 2 = a store was unreachable (never
 * silently "clean").
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/collections-catalog-drift.mjs [--slug=alchemy] [--limit=20] [--json]
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const arg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ONLY_SLUG = arg('slug');
const SAMPLE_LIMIT = Number(arg('limit') || 20);
const AS_JSON = args.includes('--json');

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing MONGODB_URI, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

// ── Supabase side ──────────────────────────────────────────────────────────
// supabase-js silently caps every response at 1,000 rows — no error, just a
// truncated array. Page with .range() or this audit invents drift by the
// tens of thousands.
const PAGE = 1000;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const catalog = new Map(); // book id -> Set(collection slugs)
let offset = 0;
for (;;) {
  const { data, error } = await supabase
    .from('books_catalog')
    .select('id, collections')
    .eq('visible', true)
    .gt('pages_count', 0)
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) {
    console.error(`Supabase read failed at offset ${offset}: ${error.message}`);
    process.exit(2);
  }
  for (const row of data) catalog.set(row.id, new Set(row.collections || []));
  if (data.length < PAGE) break;
  offset += PAGE;
}

// ── Mongo side ─────────────────────────────────────────────────────────────
let client;
try {
  client = new MongoClient(MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 15000 });
  await client.connect();
} catch (err) {
  console.error(`Cannot reach Mongo: ${err.message}`);
  process.exit(2);
}

const books = client.db('bookstore').collection('books');
// The grid's own filter: only these books can appear in a collection at all.
const mongoFilter = { visible: true, pages_count: { $gt: 0 } };

const cursor = books
  .find(mongoFilter, { projection: { _id: 0, id: 1, collections: 1, updated_at: 1 } })
  .batchSize(2000);

/** slug -> { missingInCatalog: [], staleInCatalog: [], noRow: [] } */
const bySlug = new Map();
const bucket = (slug) => {
  if (!bySlug.has(slug)) bySlug.set(slug, { missingInCatalog: [], staleInCatalog: [], noRow: [] });
  return bySlug.get(slug);
};

let mongoBooks = 0;
let booksWithDrift = 0;
let booksWithoutRow = 0;
// Positive control: how many tags each side actually carries. A clean report is
// worthless if both sides read as empty — that would look identical to "no
// drift" while proving only that the projection is wrong.
let mongoTags = 0;
let catalogTags = 0;
for (const slugs of catalog.values()) catalogTags += slugs.size;
const seen = new Set();

for await (const book of cursor) {
  mongoBooks += 1;
  const id = book.id;
  seen.add(id);
  const mongoSlugs = new Set((book.collections || []).filter(Boolean));
  mongoTags += mongoSlugs.size;
  const row = catalog.get(id);

  if (!row) {
    // No mirror row at all — the book cannot appear in ANY of its collections.
    if (mongoSlugs.size) {
      booksWithoutRow += 1;
      for (const slug of mongoSlugs) {
        if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
        bucket(slug).noRow.push(id);
      }
    }
    continue;
  }

  let drifted = false;
  for (const slug of mongoSlugs) {
    if (row.has(slug)) continue;
    if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
    bucket(slug).missingInCatalog.push(id); // tagged in Mongo, invisible on the grid
    drifted = true;
  }
  for (const slug of row) {
    if (mongoSlugs.has(slug)) continue;
    if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
    bucket(slug).staleInCatalog.push(id); // untagged in Mongo, still on the grid
    drifted = true;
  }
  if (drifted) booksWithDrift += 1;
}

// Mirror rows for books the Mongo filter did not return (hidden, zero-page, or
// deleted) are a different defect — the cleanup pass, not the tag bump. Counted,
// not itemised per slug.
const orphanRows = [...catalog.keys()].filter((id) => !seen.has(id)).length;

await client.close();

// ── Report ─────────────────────────────────────────────────────────────────
const slugRows = [...bySlug.entries()]
  .map(([slug, b]) => ({
    slug,
    missing: b.missingInCatalog.length,
    stale: b.staleInCatalog.length,
    noRow: b.noRow.length,
    total: b.missingInCatalog.length + b.staleInCatalog.length + b.noRow.length,
    sample: [...b.missingInCatalog, ...b.staleInCatalog, ...b.noRow].slice(0, 3),
  }))
  .sort((a, b) => b.total - a.total);

const totals = slugRows.reduce(
  (acc, r) => ({
    missing: acc.missing + r.missing,
    stale: acc.stale + r.stale,
    noRow: acc.noRow + r.noRow,
  }),
  { missing: 0, stale: 0, noRow: 0 },
);
const totalDrift = totals.missing + totals.stale + totals.noRow;

// Positive control, before any verdict: "no drift" and "I compared nothing"
// print identically otherwise.
if (mongoTags === 0 || catalogTags === 0) {
  console.error('One side carries no collection tags at all — the projection is wrong, not the data.');
  process.exit(2);
}

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        mongo_books: mongoBooks,
        catalog_rows: catalog.size,
        mongo_tags: mongoTags,
        catalog_tags: catalogTags,
        books_with_drift: booksWithDrift,
        books_without_row: booksWithoutRow,
        orphan_catalog_rows: orphanRows,
        totals,
        collections: slugRows,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Mongo books (visible, pages_count > 0): ${mongoBooks.toLocaleString()}`);
  console.log(`books_catalog rows (same filter):       ${catalog.size.toLocaleString()}`);
  console.log(
    `Collection tags compared:               ${mongoTags.toLocaleString()} (Mongo)` +
      ` vs ${catalogTags.toLocaleString()} (catalog)`,
  );
  console.log('');
  console.log(`Books whose collections disagree:       ${booksWithDrift.toLocaleString()}`);
  console.log(`Books tagged but with NO catalog row:   ${booksWithoutRow.toLocaleString()}`);
  console.log(`Catalog rows for non-gridable books:    ${orphanRows.toLocaleString()}`);
  console.log('');
  console.log(`Tag-drift entries: ${totalDrift.toLocaleString()}`);
  console.log(`  missing in catalog (grid too small): ${totals.missing.toLocaleString()}`);
  console.log(`  stale in catalog (grid too big):     ${totals.stale.toLocaleString()}`);
  console.log(`  no catalog row at all:               ${totals.noRow.toLocaleString()}`);

  if (slugRows.length) {
    console.log(`\nWorst ${Math.min(SAMPLE_LIMIT, slugRows.length)} collections:`);
    for (const r of slugRows.slice(0, SAMPLE_LIMIT)) {
      console.log(
        `  ${r.slug.padEnd(34)} missing ${String(r.missing).padStart(5)}` +
          `  stale ${String(r.stale).padStart(5)}  no-row ${String(r.noRow).padStart(5)}` +
          `   e.g. ${r.sample.join(', ')}`,
      );
    }
  }

  if (totalDrift) {
    console.log(
      '\nRepair is a human decision: a `--full` books_catalog sync, or a targeted' +
        '\n`updated_at` bump on the drifted ids so the incremental sync collects them.',
    );
  }
}

process.exit(totalDrift > 0 ? 1 : 0);
