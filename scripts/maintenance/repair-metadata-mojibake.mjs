#!/usr/bin/env node
/**
 * Repair confirmed transcoding damage in bibliographic metadata (#3705).
 *
 * Scope is deliberately narrow — see `scripts/lib/mojibake.mjs` for why the substitution
 * table is tiny and what evidence backs each rule. This script only *applies* that table;
 * it never guesses.
 *
 * Covers:
 *   - `books` top-level metadata fields (REPAIRABLE_BOOK_FIELDS)
 *   - `books.source_work_dates[].work_title` (AI-enrichment copied the damaged title)
 *   - the `authors` thesaurus (`name`, `display_name`), which is built from book records
 *
 * Does NOT touch page text, OCR, or translations: a page image can genuinely contain the
 * sequence, and page text is evidence rather than metadata.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-metadata-mojibake.mjs
 *   node --env-file=.env.production.local scripts/maintenance/repair-metadata-mojibake.mjs --apply
 *
 * After --apply the script prints the follow-up steps that make the change visible
 * (Supabase catalog sync + ISR revalidation), because a Mongo-only title fix leaves the
 * search and collection surfaces reading the old value.
 */
import { MongoClient } from 'mongodb';
import {
  MOJIBAKE_RULES,
  REPAIRABLE_BOOK_FIELDS,
  findMojibake,
  repairMojibake,
} from '../lib/mojibake.mjs';

/**
 * Author duplicates minted BY the mojibake, resolved by hand (#3705).
 *
 * Repairing `books.author` is not enough on its own: the thesaurus builder keyed a doc off
 * the damaged string, so `BL·ssariōn` became its own person with its own `/author/` page,
 * sitting alongside the real one. Fixing only the string would leave those books pointing
 * at a duplicate whose canonical_name happened to be spelled right.
 *
 * These pairs are REVIEWED, not derived. The invariant doc (`author-identity.md`) warns
 * that matching a repaired string into an existing doc by canonical-key over that doc's
 * variants can land on a compound or conflated variant and absorb a different person — so
 * this list is hardcoded and each entry states the evidence, rather than being computed.
 *
 * Merge shape follows the existing dedup-2250 tombstones: the duplicate keeps its _id and
 * gains `merged_into`, and its slug joins the primary's `variant_slugs` so the old URL
 * 301s to the canonical person (`src/lib/author-thesaurus.ts:176-182`).
 */
const REVIEWED_AUTHOR_MERGES = [
  {
    from: 'bl-ssarion',
    into: 'basilios-bessarion',
    // The two books read "Quæ hoc in volumine tractantur. Bessarionis cardinalis Niceni…",
    // i.e. Cardinal Bessarion of Nicaea. The primary (VIAF 100183781, Wikidata Q299446)
    // ALREADY carries a correctly-encoded "Bēssariōn, Cardinal, 1403–1472; …" variant,
    // which is independent confirmation that the repaired string names this same person.
    evidence: 'Bessarionis cardinalis Niceni; primary holds correctly-encoded Bēssariōn variant',
  },
];

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with: node --env-file=.env.production.local …');
  process.exit(1);
}

// One regex that matches any rule, for the initial candidate query. Rules are plain
// strings, so escape them rather than trusting them as patterns.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_RULE = new RegExp(MOJIBAKE_RULES.map((r) => escape(r.from)).join('|'));

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

let bookDocsChanged = 0;
let bookFieldsChanged = 0;
let authorDocsChanged = 0;
const touchedBookIds = [];

// ---------------------------------------------------------------- books
// Cast wide on selection and let the per-field logic decide: a book is a candidate if the
// bigram appears in ANY repairable path, and the two nested arrays are checked separately
// because a dotted query cannot reach into them.
const bookQuery = {
  $or: [
    ...REPAIRABLE_BOOK_FIELDS.map((f) => ({ [f]: ANY_RULE })),
    { 'source_work_dates.work_title': ANY_RULE },
  ],
};

const books = await db.collection('books').find(bookQuery).toArray();
console.log(`books matching a mojibake rule: ${books.length}\n`);

for (const book of books) {
  const set = {};

  for (const field of REPAIRABLE_BOOK_FIELDS) {
    // Dotted paths (`summary.data`) resolve against nested objects. Mongo's $set accepts
    // the same dotted form, so the write below needs no special handling.
    const before = field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), book);
    const after = repairMojibake(before);
    if (typeof before === 'string' && after !== before) {
      set[field] = after;
      const hits = findMojibake(before);
      console.log(`${book._id}  ${field}`);
      console.log(`   - ${JSON.stringify(before).slice(0, 150)}`);
      console.log(`   + ${JSON.stringify(after).slice(0, 150)}`);
      console.log(`   (${hits.map((h) => `${h.count}× ${h.from}→${h.to}`).join(', ')})`);
      bookFieldsChanged++;
    }
  }

  // Nested: the AI date-enrichment copied the damaged title into its own record.
  // Rewrite the whole array rather than a positional update — there can be several
  // entries and only some of them damaged.
  if (Array.isArray(book.source_work_dates)) {
    const repaired = book.source_work_dates.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const after = repairMojibake(entry.work_title);
      return after === entry.work_title ? entry : { ...entry, work_title: after };
    });
    const changed = repaired.some((e, i) => e !== book.source_work_dates[i]);
    if (changed) {
      set.source_work_dates = repaired;
      console.log(`${book._id}  source_work_dates[].work_title repaired`);
      bookFieldsChanged++;
    }
  }

  if (Object.keys(set).length === 0) continue;
  bookDocsChanged++;
  if (book.id) touchedBookIds.push(book.id);

  if (APPLY) {
    // `updated_at` matters: the Supabase catalog sync selects on it, so a write without
    // it lands in Mongo and never reaches the surfaces that actually render the title.
    set.updated_at = new Date();
    const res = await db.collection('books').updateOne({ _id: book._id }, { $set: set });
    if (res.modifiedCount !== 1) {
      console.error(`   !! expected modifiedCount 1, got ${res.modifiedCount} for ${book._id}`);
    }
  }
}

// ---------------------------------------------------------------- authors thesaurus
const authorFields = ['name', 'display_name', 'canonical_name'];
const authorQuery = { $or: authorFields.map((f) => ({ [f]: ANY_RULE })) };
const authors = await db.collection('authors').find(authorQuery).toArray();
console.log(`\nauthors matching a mojibake rule: ${authors.length}`);

for (const a of authors) {
  const set = {};
  for (const field of authorFields) {
    const after = repairMojibake(a[field]);
    if (typeof a[field] === 'string' && after !== a[field]) {
      set[field] = after;
      console.log(`${a._id}  ${field}: ${JSON.stringify(a[field])} -> ${JSON.stringify(after)}`);
    }
  }
  if (Object.keys(set).length === 0) continue;
  authorDocsChanged++;
  if (APPLY) {
    set.updated_at = new Date();
    await db.collection('authors').updateOne({ _id: a._id }, { $set: set });
  }
}

// ------------------------------------------------- reviewed author merges
let merged = 0;
let repointed = 0;

for (const merge of REVIEWED_AUTHOR_MERGES) {
  const dup = await db.collection('authors').findOne({ _id: merge.from });
  const primary = await db.collection('authors').findOne({ _id: merge.into });

  if (!dup) {
    console.log(`\nmerge ${merge.from} -> ${merge.into}: duplicate already gone, skipping`);
    continue;
  }
  if (!primary) {
    console.error(`\n!! merge ${merge.from} -> ${merge.into}: PRIMARY NOT FOUND, refusing`);
    continue;
  }
  if (dup.merged_into) {
    console.log(`\nmerge ${merge.from}: already tombstoned into ${dup.merged_into}, skipping`);
    continue;
  }

  const linked = await db.collection('books')
    .find({ author_id: merge.from }, { projection: { id: 1 } })
    .toArray();

  console.log(`\nmerge ${merge.from} -> ${merge.into}`);
  console.log(`  evidence: ${merge.evidence}`);
  console.log(`  books to repoint: ${linked.length}`);

  merged++;
  repointed += linked.length;

  if (!APPLY) continue;

  // Repoint the books first. If the run dies between steps, books pointing at a
  // not-yet-tombstoned duplicate still resolve; a tombstone with books still pointing
  // at nothing would be the worse half-state.
  if (linked.length > 0) {
    const res = await db.collection('books').updateMany(
      { author_id: merge.from },
      { $set: { author_id: merge.into, updated_at: new Date() } },
    );
    console.log(`  repointed ${res.modifiedCount} books`);
  }

  // The duplicate's slug must live in the primary's variant_slugs for the old URL to
  // 301 — that is the shape the read path documents. $addToSet keeps this idempotent.
  await db.collection('authors').updateOne(
    { _id: merge.into },
    {
      $addToSet: {
        variant_slugs: merge.from,
        variants: repairMojibake(dup.canonical_name),
      },
      $set: { updated_at: new Date() },
    },
  );

  await db.collection('authors').updateOne(
    { _id: merge.from },
    {
      $set: {
        merged_into: merge.into,
        merge_run: 'mojibake-3705',
        // Repair the tombstone's own name too, so the damaged string does not survive
        // as the last copy of itself.
        canonical_name: repairMojibake(dup.canonical_name),
        updated_at: new Date(),
      },
    },
  );
  console.log('  tombstoned');
}

// ---------------------------------------------------------------- report
console.log('\n' + '='.repeat(60));
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN (pass --apply to write)'}`);
console.log(`  book documents changed:  ${bookDocsChanged}`);
console.log(`  book fields changed:     ${bookFieldsChanged}`);
console.log(`  author documents changed: ${authorDocsChanged}`);
console.log(`  author duplicates merged:  ${merged} (${repointed} books repointed)`);

if (APPLY && touchedBookIds.length > 0) {
  console.log('\nNot yet visible to readers.');
  console.log('  Supabase: `scripts/workers/sync-books-catalog.mjs` runs on Hetzner every 5 min over a');
  console.log('  last-10-min `updated_at` window, and this script stamps `updated_at`, so books_catalog');
  console.log('  picks these up on its own. VERIFY rather than assume — the window has no retry.');
  console.log('  Then revalidate the affected book pages and purge Cloudflare (24h CDN TTL on /book/*).');
  console.log(`\nTouched book ids:\n  ${touchedBookIds.join('\n  ')}`);
}

await client.close();
