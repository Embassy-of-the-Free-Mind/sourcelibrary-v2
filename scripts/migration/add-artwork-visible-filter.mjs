/**
 * Add a `visible` column to artwork_embeddings and teach match_artworks_semantic
 * to hide non-visible artworks — the RPC-layer half of the hidden-artwork
 * semantic-leak fix (issue: hidden artworks surfacing in semantic search).
 *
 * Background: backfill-artwork-embeddings.mjs only embeds `visible: true`
 * artworks, but in --incremental mode it never removes rows for artworks that
 * are hidden *after* embedding. At the time this migration was written 7,484 of
 * 22,200 embedding rows (33.7%) were for artworks now hidden in Mongo, and the
 * RPC had no visibility filter — so librarian search_artworks, /api/search/unified
 * and /api/identify (which consume RPC rows directly) could surface hidden
 * artworks. This is the parallel of the books visible/hidden invariant.
 *
 * What it does (idempotent):
 *   1. ADD COLUMN visible boolean DEFAULT true (fail-safe default)
 *   2. Backfill `visible` from Mongo (UPDATE-only — no re-embed, no Gemini cost)
 *   3. Index (visible)
 *   4. Replace match_artworks_semantic with `AND ae.visible IS NOT FALSE`
 *      — IS NOT FALSE (not `= true`) so partial backfill / new NULL inserts
 *      fail safe as visible rather than silently vanishing.
 *
 * Ongoing sync: run this script (or its backfill step) whenever artwork
 * visibility changes at scale; the insert path in backfill-artwork-embeddings.mjs
 * also stamps visible=true. Cheap to re-run — it's UPDATE-only.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/add-artwork-visible-filter.mjs [--dry-run] [--skip-rpc]
 */
import pg from 'pg';
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_RPC = process.argv.includes('--skip-rpc');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const MONGODB_URI = process.env.MONGODB_URI;
if (!SUPABASE_DB_URL || !MONGODB_URI) {
  console.error('Missing SUPABASE_DB_URL or MONGODB_URI');
  process.exit(1);
}

const RPC_SQL = `
CREATE OR REPLACE FUNCTION public.match_artworks_semantic(
  query_embedding halfvec,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20,
  filter_genre text DEFAULT NULL,
  filter_period text DEFAULT NULL,
  filter_culture text DEFAULT NULL,
  filter_collection text DEFAULT NULL
) RETURNS TABLE (
  book_id text, title text, display_title text, author text, summary_text text,
  subjects text[], figures text[], symbols text[], iconclass text[],
  technique text, period text, culture text, genre text, collections text[],
  resource_type text, thumbnail_url text, ulan_artist integer, similarity double precision
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT
    ae.book_id, ae.title, ae.display_title, ae.author, ae.summary_text,
    ae.subjects, ae.figures, ae.symbols, ae.iconclass, ae.technique, ae.period, ae.culture,
    ae.genre, ae.collections, ae.resource_type, ae.thumbnail_url, ae.ulan_artist,
    (1 - (ae.embedding <=> query_embedding))::float AS similarity
  FROM artwork_embeddings ae
  WHERE (1 - (ae.embedding <=> query_embedding)) > match_threshold
    AND ae.visible IS NOT FALSE
    AND (filter_genre IS NULL OR ae.genre = filter_genre)
    AND (filter_period IS NULL OR ae.period = filter_period)
    AND (filter_culture IS NULL OR ae.culture = filter_culture)
    AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
END; $$;
`;

async function main() {
  const c = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  // 1. Add column
  console.log('1. Adding `visible` column (DEFAULT true)...');
  if (!DRY_RUN) {
    await c.query(`ALTER TABLE artwork_embeddings ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true`);
  }

  // 2. Backfill from Mongo — collect all book_ids, look up visibility, UPDATE hidden ones.
  const { rows } = await c.query('SELECT book_id FROM artwork_embeddings');
  const ids = rows.map(r => r.book_id);
  console.log(`2. Backfilling visibility for ${ids.length} embedding rows...`);

  // Fetch hidden ids from Mongo (the minority). Anything not returned stays visible.
  const hidden = new Set();
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const docs = await db.collection('books')
      .find({ id: { $in: chunk }, visible: { $ne: true } }, { projection: { id: 1 } })
      .toArray();
    for (const d of docs) hidden.add(d.id);
  }
  console.log(`   ${hidden.size} of ${ids.length} rows are hidden in Mongo (${(100 * hidden.size / ids.length).toFixed(1)}%)`);

  if (!DRY_RUN) {
    // Reset all to visible, then flip the hidden set false — keeps the column
    // in sync even if a row was previously mismarked.
    await c.query(`UPDATE artwork_embeddings SET visible = true WHERE visible IS DISTINCT FROM true`);
    const hiddenArr = [...hidden];
    for (let i = 0; i < hiddenArr.length; i += 2000) {
      const chunk = hiddenArr.slice(i, i + 2000);
      await c.query(`UPDATE artwork_embeddings SET visible = false WHERE book_id = ANY($1)`, [chunk]);
    }
    console.log(`   Marked ${hidden.size} rows visible=false.`);
  }

  // 3. Index
  console.log('3. Indexing (visible)...');
  if (!DRY_RUN) {
    await c.query(`CREATE INDEX IF NOT EXISTS artwork_embeddings_visible_idx ON artwork_embeddings (visible)`);
  }

  // 4. Replace RPC
  if (SKIP_RPC) {
    console.log('4. Skipping RPC swap (--skip-rpc).');
  } else {
    console.log('4. Replacing match_artworks_semantic RPC with `visible IS NOT FALSE` filter...');
    if (!DRY_RUN) {
      // Drop both possible signatures first — CREATE OR REPLACE can't change the
      // return type / arg defaults cleanly across the vector→halfvec migration.
      await c.query(`DROP FUNCTION IF EXISTS public.match_artworks_semantic(halfvec, double precision, integer, text, text, text, text)`);
      await c.query(RPC_SQL);
    }
  }

  // Verify
  if (!DRY_RUN && !SKIP_RPC) {
    const check = await c.query(`SELECT count(*) FILTER (WHERE visible = false) AS hidden, count(*) AS total FROM artwork_embeddings`);
    console.log(`\nDone. artwork_embeddings: ${check.rows[0].total} rows, ${check.rows[0].hidden} now marked hidden (excluded by RPC).`);
  } else {
    console.log(`\n${DRY_RUN ? 'DRY RUN — no writes.' : 'Done.'}`);
  }

  await c.end();
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
