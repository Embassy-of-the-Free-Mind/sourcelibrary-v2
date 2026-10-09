/**
 * Project `books.preview` into Supabase `books_catalog` so catalogue-fed cards
 * can show the "Preview" badge on partial scans.
 *
 * Why: `books.preview` is true when a source (e.g. museumsofindia) hosts only a
 * few page images of a larger physical manuscript, so the book is a partial
 * scan / preview. It is independent of publication — a preview can be public.
 *
 * What it does (idempotent, safe to re-run):
 *   1. ADD COLUMN IF NOT EXISTS preview boolean — nullable, no default.
 *      NULL means "not a preview", so existing rows stay valid mid-backfill.
 *   2. Backfill from Mongo — SET preview=true for every book marked preview,
 *      and clear any catalog row Mongo no longer marks. NULL = not preview.
 *   3. Verify by reading information_schema and counting. A committed migration
 *      file is not proof of what is in production (the previous books_catalog
 *      migrations image_display/image_card were committed and never landed).
 *
 * The writer half lives in scripts/workers/sync-books-catalog.mjs: the field
 * must be in BOTH the Mongo projection and the row builder — a field in the
 * builder but NOT the projection reads `undefined` and writes NULL for every
 * book. Those two edits are a pair (see the `content_type` migration, #4409).
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/add-books-catalog-preview.mjs [--dry-run]
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

  console.log('1. ALTER TABLE books_catalog ADD COLUMN preview...');
  if (!DRY_RUN) {
    await c.query(`ALTER TABLE books_catalog ADD COLUMN IF NOT EXISTS preview boolean`);
  }

  const { rows: colRows } = await c.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'books_catalog' AND column_name = 'preview'`
  );
  if (colRows.length === 0) {
    if (DRY_RUN) {
      console.log('   (dry run — column does not exist yet, skipping backfill)');
      await c.end();
      await mongo.close();
      return;
    }
    throw new Error('preview column missing after ALTER — aborting');
  }
  console.log(`   column present: ${colRows[0].data_type}, nullable=${colRows[0].is_nullable}`);

  console.log('2. Reading Mongo preview flags...');
  const docs = await db.collection('books')
    .find({ preview: true }, { projection: { _id: 0, id: 1, preview: 1 } })
    .toArray();
  console.log(`   ${docs.length} books are marked preview in Mongo.`);

  const { rows: before } = await c.query(`SELECT id FROM books_catalog WHERE preview = true`);
  console.log(`   ${before.length} catalog rows currently carry preview=true.`);

  const mongoIds = new Set(docs.map(d => d.id));
  const stale = before.map(r => r.id).filter(id => !mongoIds.has(id));

  if (DRY_RUN) {
    const inCatalog = await c.query(`SELECT count(*) AS n FROM books_catalog WHERE id = ANY($1)`, [[...mongoIds]]);
    console.log(`   ${inCatalog.rows[0].n} of them exist in books_catalog (the rest are unsynced).`);
    console.log(`   ${stale.length} catalog rows would be cleared to false.`);
    console.log('DRY RUN — nothing written.');
  } else {
    let updated = 0;
    for (let i = 0; i < docs.length; i += 1000) {
      const chunk = docs.slice(i, i + 1000);
      const res = await c.query(
        `UPDATE books_catalog b SET preview = true
           FROM (SELECT unnest($1::text[]) AS id) v
          WHERE b.id = v.id AND b.preview IS DISTINCT FROM true`,
        [chunk.map(d => d.id)]
      );
      updated += res.rowCount;
    }
    console.log(`   Set ${updated} catalog rows.`);

    if (stale.length) {
      const res = await c.query(`UPDATE books_catalog SET preview = false WHERE id = ANY($1)`, [stale]);
      console.log(`   Cleared ${res.rowCount} stale rows to false.`);
    }
  }

  console.log('3. Verifying against the live table...');
  const { rows: dist } = await c.query(
    `SELECT coalesce(preview, false) AS pv, count(*) AS n
       FROM books_catalog GROUP BY 1 ORDER BY n DESC`
  );
  console.log('   preview distribution:', dist.map(r => `preview=${r.pv}=${r.n}`).join(' '));

  await c.end();
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
