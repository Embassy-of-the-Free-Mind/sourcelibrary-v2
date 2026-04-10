#!/usr/bin/env node
/**
 * Build the Translation Census — the work-level join between USTC editions
 * and known English translations.
 *
 * This replaces the surname-level matching in build.mjs with proper
 * title-level matching using pg_trgm similarity.
 *
 * Steps:
 *   1. Sync translation_catalogs from MongoDB → Supabase
 *   2. Create materialized view joining ustc_enrichments × translation_catalogs
 *   3. Create RPC for the census page
 *
 * Usage:
 *   secret-lover run -- node scripts/catalog-coverage/build-census.mjs
 *
 * Env: MONGODB_URI, SUPABASE_DB_URL
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';

const MONGO_URI = process.env.MONGODB_URI;
const PG_URL = process.env.SUPABASE_DB_URL;

if (!MONGO_URI) { console.error('MONGODB_URI required'); process.exit(1); }
if (!PG_URL) { console.error('SUPABASE_DB_URL required'); process.exit(1); }

const pool = new pg.Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  console.log('=== Step 1: Sync translation_catalogs to Supabase ===');
  await syncCatalogs(db);

  console.log('\n=== Step 2: Build census materialized view ===');
  await buildCensusView();

  console.log('\n=== Step 3: Create census RPC ===');
  await createCensusRPC();

  console.log('\n=== Step 4: Refresh and verify ===');
  await refreshAndVerify();

  await mongo.close();
  await pool.end();
  console.log('\nDone.');
}

async function syncCatalogs(db) {
  const client = await pool.connect();
  try {
    // Create table if needed
    await client.query(`
      CREATE TABLE IF NOT EXISTS translation_catalogs (
        id serial PRIMARY KEY,
        source text NOT NULL,
        author text,
        author_surname text,
        canonical_author text,
        english_title text,
        original_title text,
        canonical_work text,
        translator text,
        pub_year text,
        publisher text,
        series text,
        completeness text,
        english_title_lower text GENERATED ALWAYS AS (lower(english_title)) STORED,
        canonical_work_lower text GENERATED ALWAYS AS (lower(canonical_work)) STORED,
        original_title_lower text GENERATED ALWAYS AS (lower(original_title)) STORED,
        author_surname_lower text GENERATED ALWAYS AS (lower(author_surname)) STORED
      );

      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    `);

    // Check current count
    const { rows: [{ count: existing }] } = await client.query('SELECT count(*) FROM translation_catalogs');
    console.log(`  Existing rows: ${existing}`);

    // Load from MongoDB
    const docs = await db.collection('translation_catalogs')
      .find({})
      .project({
        source: 1, author: 1, author_surname: 1, canonical_author: 1,
        english_title: 1, original_title: 1, canonical_work: 1,
        translator: 1, pub_year: 1, publisher: 1, series: 1, completeness: 1,
      })
      .toArray();

    console.log(`  MongoDB records: ${docs.length}`);

    if (parseInt(existing) >= docs.length - 100) {
      console.log('  Already synced, skipping (use --force to re-sync)');
      if (!process.argv.includes('--force')) return;
    }

    // Truncate and re-insert
    await client.query('TRUNCATE translation_catalogs RESTART IDENTITY');

    const BATCH = 500;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const d of batch) {
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(
          d.source || '', d.author || '', d.author_surname || '', d.canonical_author || '',
          d.english_title || '', d.original_title || '', d.canonical_work || '',
          d.translator || '', d.pub_year || '', d.publisher || '', d.series || '', d.completeness || '',
        );
      }

      await client.query(`
        INSERT INTO translation_catalogs (source, author, author_surname, canonical_author, english_title, original_title, canonical_work, translator, pub_year, publisher, series, completeness)
        VALUES ${values.join(', ')}
      `, params);

      if ((i + BATCH) % 5000 === 0 || i + BATCH >= docs.length) {
        console.log(`  Inserted ${Math.min(i + BATCH, docs.length)} / ${docs.length}`);
      }
    }

    // Create indexes for matching
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tc_author_surname_trgm ON translation_catalogs USING gin (author_surname_lower gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_tc_english_title_trgm ON translation_catalogs USING gin (english_title_lower gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_tc_canonical_work_trgm ON translation_catalogs USING gin (canonical_work_lower gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_tc_original_title_trgm ON translation_catalogs USING gin (original_title_lower gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_tc_author_surname ON translation_catalogs (author_surname_lower);
    `);

    console.log(`  Synced ${docs.length} records with trigram indexes`);
  } finally {
    client.release();
  }
}

async function buildCensusView() {
  const client = await pool.connect();
  try {
    // Drop old view if exists
    await client.query('DROP MATERIALIZED VIEW IF EXISTS translation_census_by_language CASCADE');

    // The core matching logic:
    // For each USTC enrichment, check if there's a translation_catalog entry where:
    //   - Author surname matches (exact or very close)
    //   - AND either:
    //     a. english_title is similar (trigram similarity > 0.3), OR
    //     b. canonical_work matches the std_title (for original-language matching), OR
    //     c. original_title matches the std_title
    //
    // We do this as a lateral join to avoid N×M explosion, grouped by language.
    //
    // Key insight: we match at the WORK level by deduplicating on
    // (author_surname, normalized english_title) — so multiple editions
    // of the same work count once.

    console.log('  Creating translation_census_by_language materialized view...');

    // First: create a helper view of distinct works from USTC enrichments
    await client.query(`
      DROP MATERIALIZED VIEW IF EXISTS ustc_distinct_works CASCADE;

      CREATE MATERIALIZED VIEW ustc_distinct_works AS
      SELECT
        MIN(e.id) AS sample_id,
        -- Normalize: lowercase, strip punctuation for grouping
        lower(regexp_replace(
          CASE WHEN position(',' IN ue.author_1) > 0
               THEN left(ue.author_1, position(',' IN ue.author_1) - 1)
               ELSE split_part(ue.author_1, ' ', 1)
          END,
          '[^a-z ]', '', 'g'
        )) AS author_surname,
        lower(regexp_replace(e.std_title, '[^a-z0-9 ]', '', 'g')) AS work_key,
        e.detected_language AS language,
        MIN(e.english_title) AS english_title,
        MIN(e.std_title) AS std_title,
        MIN(ue.author_1) AS author,
        MIN(ue.year) AS year,
        count(*) AS edition_count
      FROM ustc_enrichments e
      JOIN ustc_editions ue ON ue.id = e.id
      WHERE e.std_title IS NOT NULL
        AND e.std_title != ''
        AND ue.year BETWEEN 1450 AND 1700
      GROUP BY author_surname, work_key, e.detected_language;
    `);

    const { rows: [{ count: workCount }] } = await client.query('SELECT count(*) FROM ustc_distinct_works');
    console.log(`  Distinct works: ${parseInt(workCount).toLocaleString()}`);

    // Now: match works against translation catalogs
    // Surname matching uses trigram similarity (not exact) because USTC uses
    // Latin forms (Ficinus) while catalogs use English (Ficino).
    // Title matching uses trigram similarity on english_title, canonical_work,
    // and original_title.

    // First, create a GIN index on the distinct works author_surname for trigram
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_udw_surname_trgm ON ustc_distinct_works USING gin (author_surname gin_trgm_ops);
    `);

    await client.query(`
      DROP MATERIALIZED VIEW IF EXISTS translation_census_matches CASCADE;

      CREATE MATERIALIZED VIEW translation_census_matches AS
      WITH catalog_normalized AS (
        SELECT
          id,
          author_surname_lower AS surname,
          lower(regexp_replace(english_title, '[^a-z0-9 ]', '', 'g')) AS eng_title_norm,
          lower(regexp_replace(coalesce(canonical_work, ''), '[^a-z0-9 ]', '', 'g')) AS work_norm,
          lower(regexp_replace(coalesce(original_title, ''), '[^a-z0-9 ]', '', 'g')) AS orig_title_norm,
          source,
          english_title,
          translator,
          pub_year,
          completeness
        FROM translation_catalogs
        WHERE english_title IS NOT NULL AND english_title != ''
      )
      SELECT DISTINCT ON (w.author_surname, w.work_key)
        w.author_surname,
        w.work_key,
        w.language,
        w.english_title AS ustc_english_title,
        w.std_title AS ustc_std_title,
        w.author,
        w.year,
        w.edition_count,
        c.english_title AS catalog_english_title,
        c.translator,
        c.pub_year AS translation_year,
        c.source AS catalog_source,
        c.completeness,
        similarity(w.author_surname, c.surname) AS surname_score,
        -- Match quality score (best of title matches)
        GREATEST(
          similarity(lower(w.english_title), c.eng_title_norm),
          CASE WHEN c.work_norm != '' THEN similarity(w.work_key, c.work_norm) ELSE 0 END,
          CASE WHEN c.orig_title_norm != '' THEN similarity(w.work_key, c.orig_title_norm) ELSE 0 END
        ) AS match_score
      FROM ustc_distinct_works w
      JOIN catalog_normalized c
        ON (
          -- Surname match: exact, prefix, or trigram similar
          c.surname = w.author_surname
          OR w.author_surname LIKE c.surname || '%'
          OR c.surname LIKE w.author_surname || '%'
          OR similarity(w.author_surname, c.surname) > 0.4
        )
        AND (
          -- Title match: at least one title field is similar
          similarity(lower(w.english_title), c.eng_title_norm) > 0.2
          OR (c.work_norm != '' AND similarity(w.work_key, c.work_norm) > 0.25)
          OR (c.orig_title_norm != '' AND similarity(w.work_key, c.orig_title_norm) > 0.25)
        )
      ORDER BY w.author_surname, w.work_key, match_score DESC;
    `);

    const { rows: [{ count: matchCount }] } = await client.query('SELECT count(*) FROM translation_census_matches');
    console.log(`  Work-level matches: ${parseInt(matchCount).toLocaleString()}`);

    // Finally: the summary view by language
    await client.query(`
      CREATE MATERIALIZED VIEW translation_census_by_language AS
      SELECT
        w.language,
        count(*) AS total_works,
        sum(w.edition_count) AS total_editions,
        count(m.author_surname) AS works_with_translation,
        sum(CASE WHEN m.author_surname IS NOT NULL THEN w.edition_count ELSE 0 END) AS editions_with_translation,
        round(count(m.author_surname)::numeric / NULLIF(count(*), 0) * 100, 2) AS pct_works_translated,
        count(DISTINCT w.author_surname) AS distinct_authors,
        count(DISTINCT CASE WHEN m.author_surname IS NOT NULL THEN w.author_surname END) AS authors_with_translation
      FROM ustc_distinct_works w
      LEFT JOIN translation_census_matches m
        ON m.author_surname = w.author_surname AND m.work_key = w.work_key
      GROUP BY w.language
      ORDER BY total_works DESC;
    `);

    // Create indexes on materialized views
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_census_lang ON translation_census_by_language (language);
      CREATE INDEX IF NOT EXISTS idx_census_matches_surname ON translation_census_matches (author_surname);
      CREATE INDEX IF NOT EXISTS idx_census_matches_lang ON translation_census_matches (language);
      CREATE INDEX IF NOT EXISTS idx_udw_surname ON ustc_distinct_works (author_surname);
      CREATE INDEX IF NOT EXISTS idx_udw_lang ON ustc_distinct_works (language);
    `);

    console.log('  Materialized views created with indexes');
  } finally {
    client.release();
  }
}

async function createCensusRPC() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION get_translation_census()
      RETURNS json
      LANGUAGE sql
      STABLE
      AS $$
        SELECT json_build_object(
          'by_language', (
            SELECT json_agg(row_to_json(t) ORDER BY t.total_works DESC)
            FROM translation_census_by_language t
          ),
          'totals', (
            SELECT json_build_object(
              'total_works', sum(total_works),
              'total_editions', sum(total_editions),
              'works_with_translation', sum(works_with_translation),
              'editions_with_translation', sum(editions_with_translation),
              'pct_works_translated', round(sum(works_with_translation)::numeric / NULLIF(sum(total_works), 0) * 100, 2),
              'distinct_authors', sum(distinct_authors),
              'authors_with_translation', sum(authors_with_translation)
            )
            FROM translation_census_by_language
          ),
          'built_at', now()
        );
      $$;
    `);

    // Also: a search function for the census page
    await client.query(`
      CREATE OR REPLACE FUNCTION search_translation_census(query text, max_results int DEFAULT 30)
      RETURNS json
      LANGUAGE sql
      STABLE
      AS $$
        WITH search_results AS (
          SELECT
            w.author_surname,
            w.work_key,
            w.language,
            w.english_title AS ustc_english_title,
            w.std_title,
            w.author,
            w.year,
            w.edition_count,
            m.catalog_english_title,
            m.translator,
            m.translation_year,
            m.catalog_source,
            m.match_score,
            m.completeness,
            CASE WHEN m.author_surname IS NOT NULL THEN 'translated' ELSE 'untranslated' END AS status
          FROM ustc_distinct_works w
          LEFT JOIN translation_census_matches m
            ON m.author_surname = w.author_surname AND m.work_key = w.work_key
          WHERE w.author_surname % lower(query)
             OR lower(w.english_title) ILIKE '%' || lower(query) || '%'
             OR lower(w.std_title) ILIKE '%' || lower(query) || '%'
          ORDER BY
            CASE WHEN m.author_surname IS NOT NULL THEN 0 ELSE 1 END,
            similarity(w.author_surname, lower(query)) DESC,
            w.edition_count DESC
          LIMIT max_results
        )
        SELECT json_build_object(
          'results', (SELECT coalesce(json_agg(row_to_json(r)), '[]'::json) FROM search_results r),
          'total', (SELECT count(*) FROM search_results)
        );
      $$;
    `);

    console.log('  RPCs created: get_translation_census, search_translation_census');
  } finally {
    client.release();
  }
}

async function refreshAndVerify() {
  const client = await pool.connect();
  try {
    // Show results
    const { rows } = await client.query('SELECT * FROM translation_census_by_language ORDER BY total_works DESC LIMIT 10');
    console.log('\n  Census results:');
    console.log('  ' + 'Language'.padEnd(14) + 'Works'.padStart(10) + 'Translated'.padStart(12) + 'Pct'.padStart(8));
    console.log('  ' + '-'.repeat(44));

    let totalWorks = 0, totalTrans = 0;
    for (const r of rows) {
      totalWorks += parseInt(r.total_works);
      totalTrans += parseInt(r.works_with_translation);
      console.log('  ' +
        r.language.padEnd(14) +
        parseInt(r.total_works).toLocaleString().padStart(10) +
        parseInt(r.works_with_translation).toLocaleString().padStart(12) +
        (r.pct_works_translated + '%').padStart(8)
      );
    }
    console.log('  ' + '-'.repeat(44));
    console.log('  ' +
      'TOTAL'.padEnd(14) +
      totalWorks.toLocaleString().padStart(10) +
      totalTrans.toLocaleString().padStart(12) +
      ((totalTrans / totalWorks * 100).toFixed(2) + '%').padStart(8)
    );

    // Sample some matches for spot-checking
    console.log('\n  Sample matches (spot-check):');
    const { rows: samples } = await client.query(`
      SELECT author_surname, ustc_std_title, catalog_english_title, catalog_source, match_score
      FROM translation_census_matches
      ORDER BY match_score DESC
      LIMIT 10
    `);
    for (const s of samples) {
      console.log(`  [${s.match_score.toFixed(2)}] ${s.author_surname}: "${s.ustc_std_title}" → "${s.catalog_english_title}" (${s.catalog_source})`);
    }

    // Also show some low-score matches to check for false positives
    console.log('\n  Lowest-score matches (check for false positives):');
    const { rows: lowSamples } = await client.query(`
      SELECT author_surname, ustc_std_title, catalog_english_title, catalog_source, match_score
      FROM translation_census_matches
      WHERE match_score < 0.35
      ORDER BY match_score ASC
      LIMIT 10
    `);
    for (const s of lowSamples) {
      console.log(`  [${s.match_score.toFixed(2)}] ${s.author_surname}: "${s.ustc_std_title}" → "${s.catalog_english_title}" (${s.catalog_source})`);
    }
  } finally {
    client.release();
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
