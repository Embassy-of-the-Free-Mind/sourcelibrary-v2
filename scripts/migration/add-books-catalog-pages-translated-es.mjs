/**
 * #4166 — project `books.pages_translated_es` into Supabase `books_catalog`.
 *
 * Why: `hasLocalizedEdition()` (src/lib/localized.ts) answers "does this book
 * exist in Spanish?" from either a native `language` match (#4120) or
 * `pages_translated_es > 0`. Catalog-fed surfaces — the /es homepage rails,
 * anything rendering CollectionBookCard without an explicit href — read
 * `CatalogBook`, which carried `language` but not the counter, because the
 * column did not exist on the table at all. So natives resolved and
 * translated-into-Spanish books silently linked to their ENGLISH page,
 * dropping the reader off the /es prefix mid-visit.
 *
 * What it does (idempotent, safe to re-run):
 *   1. ADD COLUMN IF NOT EXISTS pages_translated_es integer NOT NULL DEFAULT 0
 *      — DEFAULT 0 so every pre-existing row reads as "no Spanish edition",
 *        which is the fail-toward direction: a missing counter must never
 *        mint an /es URL we cannot serve.
 *   2. Partial index WHERE pages_translated_es > 0 (the only predicate any
 *      caller uses; the column is 0 for nearly every row).
 *   3. Backfill from Mongo — SET for every book with a nonzero counter, and
 *      RESET to 0 for any catalog row that carries one Mongo no longer does
 *      (a re-run repairs drift in both directions).
 *
 * The writer half of this lives in scripts/workers/sync-books-catalog.mjs:
 * the field must be in BOTH the Mongo projection and the row builder. The
 * upsert is `onConflict: 'id'`, so a column left out of the row object is
 * left untouched rather than zeroed — but a field in the row builder and NOT
 * in the projection reads `undefined` and writes 0 for every book. Those two
 * edits are a pair (#4120/#4141 is the cost of landing half a widening).
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/add-books-catalog-pages-translated-es.mjs [--dry-run]
 *   (foreground only — SUPABASE_DB_URL needs Touch ID)
 */
import pg from 'pg';
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const MONGODB_URI = process.env.MONGODB_URI;
if (!SUPABASE_DB_URL || !MONGODB_URI) {
  console.error('Missing SUPABASE_DB_URL or MONGODB_URI');
  process.exit(1);
}

async function main() {
  const c = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  console.log('1. ALTER TABLE books_catalog ADD COLUMN pages_translated_es...');
  if (!DRY_RUN) {
    await c.query(`ALTER TABLE books_catalog ADD COLUMN IF NOT EXISTS pages_translated_es integer NOT NULL DEFAULT 0`);
    await c.query(`CREATE INDEX IF NOT EXISTS books_catalog_pages_translated_es_idx ON books_catalog (pages_translated_es) WHERE pages_translated_es > 0`);
  }

  console.log('2. Reading Mongo counters (books.pages_translated_es > 0)...');
  const docs = await db.collection('books')
    .find({ pages_translated_es: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_translated_es: 1 } })
    .toArray();
  console.log(`   ${docs.length} books carry a Spanish page count in Mongo.`);

  const { rows: before } = await c.query(
    `SELECT id FROM books_catalog WHERE pages_translated_es > 0`
  );
  console.log(`   ${before.length} catalog rows currently carry one.`);

  const mongoIds = new Set(docs.map(d => d.id));
  const stale = before.map(r => r.id).filter(id => !mongoIds.has(id));

  if (DRY_RUN) {
    const inCatalog = await c.query(`SELECT id FROM books_catalog WHERE id = ANY($1)`, [[...mongoIds]]);
    console.log(`   ${inCatalog.rows.length} of them exist in books_catalog (the rest are hidden/unsynced).`);
    console.log(`   ${stale.length} catalog rows would be reset to 0.`);
    console.log('DRY RUN — nothing written.');
  } else {
    let updated = 0;
    for (let i = 0; i < docs.length; i += 1000) {
      const chunk = docs.slice(i, i + 1000);
      const res = await c.query(
        `UPDATE books_catalog b SET pages_translated_es = v.n
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::int[]) AS n) v
          WHERE b.id = v.id AND b.pages_translated_es IS DISTINCT FROM v.n`,
        [chunk.map(d => d.id), chunk.map(d => d.pages_translated_es)]
      );
      updated += res.rowCount;
    }
    console.log(`   Set ${updated} catalog rows.`);

    if (stale.length) {
      const res = await c.query(
        `UPDATE books_catalog SET pages_translated_es = 0 WHERE id = ANY($1)`, [stale]
      );
      console.log(`   Reset ${res.rowCount} stale rows to 0.`);
    }

    const check = await c.query(
      `SELECT count(*) AS n, coalesce(sum(pages_translated_es), 0) AS pages
         FROM books_catalog WHERE pages_translated_es > 0`
    );
    console.log(`\nDone. books_catalog: ${check.rows[0].n} rows with a Spanish edition, ${check.rows[0].pages} Spanish pages total.`);
  }

  await c.end();
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
