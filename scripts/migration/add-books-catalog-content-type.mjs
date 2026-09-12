/**
 * #4409 — project `books.content_type` into Supabase `books_catalog`.
 *
 * Why: artworks and texts share the Mongo `books` collection, and the canonical
 * rule for telling them apart (isArtworkRecord, src/lib/artwork-record.ts) reads
 * BOTH `content_type` and `resource_type`. The catalogue mirror carried only
 * `resource_type`, so search's book lane — which reads books_catalog, not Mongo —
 * had no way to exclude artworks and rendered all 97 live artwork rows as book
 * cards pointing at /book/.
 *
 * `resource_type` alone is NOT a usable test. One live row is a real Javanese
 * chronicle ("Babad Tanah Djawi…", id 6a197add50f34ce9f2ea4a0d) carrying
 * content_type:'text' + resource_type:'text'. A "resource_type IS NOT NULL"
 * filter would silently delete it from search. That record is the negative
 * control for this whole change, and this script prints it.
 *
 * What it does (idempotent, safe to re-run):
 *   1. ADD COLUMN IF NOT EXISTS content_type text — nullable, no default.
 *      NULL means "unknown", which makes the rule fall back to resource_type,
 *      i.e. exactly the behaviour before this column existed. Rows stay valid
 *      mid-backfill.
 *   2. Partial index on content_type = 'artwork' (the only value any caller
 *      filters on).
 *   3. Backfill from Mongo — SET for every book with a content_type, and NULL
 *      any catalog row carrying one Mongo no longer does (a re-run repairs
 *      drift in both directions).
 *   4. Verify by reading information_schema and re-counting. A committed
 *      migration file is not proof of what is in production: the previous
 *      books_catalog migration (20260828000000, image_display/image_card) is
 *      committed and its columns do NOT exist on the live table.
 *
 * The writer half lives in scripts/workers/sync-books-catalog.mjs: the field
 * must be in BOTH the Mongo projection and the row builder. A field in the row
 * builder but NOT the projection reads `undefined` and writes NULL for every
 * book. Those two edits are a pair.
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/add-books-catalog-content-type.mjs [--dry-run]
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

// The one live record that proves the rule needs content_type, not resource_type.
const NEGATIVE_CONTROL_ID = '6a197add50f34ce9f2ea4a0d';

async function main() {
  const c = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  console.log('1. ALTER TABLE books_catalog ADD COLUMN content_type...');
  if (!DRY_RUN) {
    await c.query(`ALTER TABLE books_catalog ADD COLUMN IF NOT EXISTS content_type text`);
    await c.query(
      `CREATE INDEX IF NOT EXISTS books_catalog_content_type_artwork_idx
         ON books_catalog (content_type) WHERE content_type = 'artwork'`
    );
  }

  // Verify the column really exists before trusting any write below.
  const { rows: colRows } = await c.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'books_catalog' AND column_name = 'content_type'`
  );
  if (colRows.length === 0) {
    if (DRY_RUN) {
      console.log('   (dry run — column does not exist yet, skipping backfill)');
      await c.end();
      await mongo.close();
      return;
    }
    throw new Error('content_type column missing after ALTER — aborting');
  }
  console.log(`   column present: ${colRows[0].data_type}, nullable=${colRows[0].is_nullable}`);

  console.log('2. Reading Mongo content_type values...');
  const docs = await db.collection('books')
    .find({ content_type: { $exists: true, $ne: null } }, { projection: { _id: 0, id: 1, content_type: 1 } })
    .toArray();
  console.log(`   ${docs.length} books carry a content_type in Mongo.`);

  const { rows: before } = await c.query(`SELECT id FROM books_catalog WHERE content_type IS NOT NULL`);
  console.log(`   ${before.length} catalog rows currently carry one.`);

  const mongoIds = new Set(docs.map(d => d.id));
  const stale = before.map(r => r.id).filter(id => !mongoIds.has(id));

  if (DRY_RUN) {
    const inCatalog = await c.query(`SELECT count(*) AS n FROM books_catalog WHERE id = ANY($1)`, [[...mongoIds]]);
    console.log(`   ${inCatalog.rows[0].n} of them exist in books_catalog (the rest are unsynced).`);
    console.log(`   ${stale.length} catalog rows would be cleared to NULL.`);
    console.log('DRY RUN — nothing written.');
  } else {
    let updated = 0;
    for (let i = 0; i < docs.length; i += 1000) {
      const chunk = docs.slice(i, i + 1000);
      const res = await c.query(
        `UPDATE books_catalog b SET content_type = v.ct
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS ct) v
          WHERE b.id = v.id AND b.content_type IS DISTINCT FROM v.ct`,
        [chunk.map(d => d.id), chunk.map(d => String(d.content_type))]
      );
      updated += res.rowCount;
    }
    console.log(`   Set ${updated} catalog rows.`);

    if (stale.length) {
      const res = await c.query(`UPDATE books_catalog SET content_type = NULL WHERE id = ANY($1)`, [stale]);
      console.log(`   Cleared ${res.rowCount} stale rows to NULL.`);
    }
  }

  console.log('3. Verifying against the live table...');
  const { rows: dist } = await c.query(
    `SELECT coalesce(content_type, '(null)') AS ct, count(*) AS n
       FROM books_catalog GROUP BY 1 ORDER BY n DESC`
  );
  console.log('   content_type distribution:', dist.map(r => `${r.ct}=${r.n}`).join(' '));

  // The exclusion predicate search will actually run, counted on the live table.
  const { rows: live } = await c.query(
    `SELECT
        count(*) FILTER (WHERE visible AND pages_count > 0) AS live_rows,
        count(*) FILTER (WHERE visible AND pages_count > 0
                           AND (content_type = 'artwork'
                                OR (content_type IS NULL AND resource_type IS NOT NULL))) AS live_artworks
       FROM books_catalog`
  );
  console.log(`   live rows: ${live[0].live_rows}, of which artworks excluded from the book lane: ${live[0].live_artworks}`);

  const { rows: control } = await c.query(
    `SELECT id, title, content_type, resource_type, visible, pages_count,
            (content_type = 'artwork' OR (content_type IS NULL AND resource_type IS NOT NULL)) AS would_be_excluded
       FROM books_catalog WHERE id = $1`,
    [NEGATIVE_CONTROL_ID]
  );
  if (control.length === 0) {
    console.warn(`   WARNING: negative control ${NEGATIVE_CONTROL_ID} not found in books_catalog.`);
  } else {
    const r = control[0];
    console.log(`   negative control "${r.title.slice(0, 40)}…": content_type=${r.content_type} resource_type=${r.resource_type} excluded=${r.would_be_excluded}`);
    if (r.would_be_excluded) {
      throw new Error('negative control would be excluded from book search — the rule is wrong, do not ship');
    }
  }

  await c.end();
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
