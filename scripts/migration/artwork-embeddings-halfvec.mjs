#!/usr/bin/env node
/**
 * Migrate artwork_embeddings to halfvec(3072) so the HNSW index actually works.
 *
 * Context: pgvector's HNSW vector_cosine_ops caps at 2000 dims. The
 * artwork_embeddings.embedding column is 3072-dim, so CREATE INDEX silently
 * succeeds but the planner refuses to use the index — searches fall back to
 * sequential scan. pgvector ≥0.7.0 ships halfvec, which supports HNSW up to
 * 4000 dims at ~half the storage and negligible recall impact.
 *
 * What this does (idempotent, safe to re-run):
 *   1. ALTER COLUMN embedding TYPE halfvec(3072) — in-place fp32→fp16 conversion
 *   2. DROP+CREATE match_artworks_semantic RPC with halfvec parameter type
 *   3. CREATE INDEX CONCURRENTLY artwork_embeddings_embedding_idx
 *        USING hnsw (embedding halfvec_cosine_ops) WITH (m=16, ef_construction=64)
 *
 * The CONCURRENTLY clause means the index build doesn't lock writes — it's
 * safe to run while the nightly image-embeddings cron is active.
 *
 * Verify after:
 *   EXPLAIN SELECT ... ORDER BY embedding <=> $1::halfvec LIMIT 5;
 *   should show "Index Scan using artwork_embeddings_embedding_idx", not Seq Scan.
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/artwork-embeddings-halfvec.mjs
 */
import pg from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

// Direct port for long-running DDL (avoid pgbouncer transaction pooling)
const connStr = SUPABASE_DB_URL.replace(':6543/', ':5432/');

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
    AND (filter_genre IS NULL OR ae.genre = filter_genre)
    AND (filter_period IS NULL OR ae.period = filter_period)
    AND (filter_culture IS NULL OR ae.culture = filter_culture)
    AND (filter_collection IS NULL OR filter_collection = ANY(ae.collections))
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
END; $$;
`;

async function main() {
  const c = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. Check current column type — skip the ALTER if already halfvec
  const typeRow = await c.query(
    `SELECT atttypid::regtype::text AS type
       FROM pg_attribute
      WHERE attrelid = 'public.artwork_embeddings'::regclass
        AND attname = 'embedding'`,
  );
  const currentType = typeRow.rows[0]?.type;
  console.log(`Current embedding column type: ${currentType}`);

  if (currentType === 'halfvec') {
    console.log('Already halfvec, skipping ALTER COLUMN');
  } else if (currentType === 'vector') {
    console.log('Converting embedding column from vector to halfvec(3072)...');
    const t0 = Date.now();
    await c.query(
      `ALTER TABLE artwork_embeddings
         ALTER COLUMN embedding TYPE halfvec(3072) USING embedding::halfvec(3072)`,
    );
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    throw new Error(`Unexpected current column type: ${currentType}`);
  }

  // 2. Replace the RPC. DROP first because pg can't change a function's
  //    parameter types via OR REPLACE.
  console.log('Replacing match_artworks_semantic RPC with halfvec signature...');
  await c.query(
    `DROP FUNCTION IF EXISTS public.match_artworks_semantic(vector, double precision, integer, text, text, text, text)`,
  );
  await c.query(
    `DROP FUNCTION IF EXISTS public.match_artworks_semantic(halfvec, double precision, integer, text, text, text, text)`,
  );
  await c.query(RPC_SQL);
  console.log('  RPC replaced');

  // 3. Drop any stale leftover indexes from earlier attempts, then build the
  //    real one. CONCURRENTLY needs its own statement, no transaction.
  await c.query(`DROP INDEX IF EXISTS public.artwork_embeddings_embedding_idx`);
  await c.query(`DROP INDEX IF EXISTS public.artwork_embeddings_hnsw_idx`);

  console.log('Building HNSW index on halfvec column (CONCURRENTLY)...');
  const tIdx = Date.now();
  await c.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS artwork_embeddings_embedding_idx
       ON public.artwork_embeddings
       USING hnsw (embedding halfvec_cosine_ops)
       WITH (m = 16, ef_construction = 64)`,
  );
  console.log(`  index built in ${((Date.now() - tIdx) / 1000).toFixed(1)}s`);

  // 4. Verify the planner actually picks the index now.
  await c.query(`ANALYZE artwork_embeddings`);
  const sample = await c.query(`SELECT embedding::text AS v FROM artwork_embeddings LIMIT 1`);
  if (sample.rows[0]) {
    const explain = await c.query(
      `EXPLAIN SELECT book_id FROM artwork_embeddings
        ORDER BY embedding <=> $1::halfvec LIMIT 5`,
      [sample.rows[0].v],
    );
    const plan = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
    console.log('\nEXPLAIN result:\n' + plan);
    if (!plan.includes('artwork_embeddings_embedding_idx')) {
      console.warn('\n⚠  Planner did NOT pick the HNSW index — investigate before relying on it.');
      process.exitCode = 2;
    } else {
      console.log('\n✓ Planner uses the HNSW index');
    }
  }

  await c.end();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
