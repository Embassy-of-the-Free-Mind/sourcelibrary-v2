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
    // Set generous timeout for heavy queries
    await client.query("SET statement_timeout = '600s'");

    console.log('  Creating translation_census_by_language materialized view...');

    // Step 1: Create distinct works view (if not exists, reuse from previous run)
    const { rows: existingWorks } = await client.query(
      "SELECT count(*) FROM information_schema.tables WHERE table_name = 'ustc_distinct_works' AND table_type = 'VIEW'"
    ).catch(() => ({ rows: [{ count: '0' }] }));

    // Check if it's a materialized view instead
    const { rows: matViews } = await client.query(
      "SELECT count(*) FROM pg_matviews WHERE matviewname = 'ustc_distinct_works'"
    ).catch(() => ({ rows: [{ count: '0' }] }));

    if (parseInt(matViews[0]?.count || '0') === 0) {
      console.log('  Building ustc_distinct_works (this takes a few minutes)...');
      await client.query('DROP MATERIALIZED VIEW IF EXISTS translation_census_by_language CASCADE');
      await client.query('DROP MATERIALIZED VIEW IF EXISTS translation_census_matches CASCADE');
      await client.query('DROP MATERIALIZED VIEW IF EXISTS ustc_distinct_works CASCADE');

      await client.query(`
        CREATE MATERIALIZED VIEW ustc_distinct_works AS
        SELECT
          MIN(e.id) AS sample_id,
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

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_udw_surname ON ustc_distinct_works (author_surname);
        CREATE INDEX IF NOT EXISTS idx_udw_lang ON ustc_distinct_works (language);
        CREATE INDEX IF NOT EXISTS idx_udw_surname_trgm ON ustc_distinct_works USING gin (author_surname gin_trgm_ops);
      `);
    }

    const { rows: [{ count: workCount }] } = await client.query('SELECT count(*) FROM ustc_distinct_works');
    console.log(`  Distinct works: ${parseInt(workCount).toLocaleString()}`);

    // Step 2: Build matches table iteratively (avoids cross-join timeout)
    // Process one catalog surname at a time
    console.log('  Building matches table (iterative by catalog surname)...');

    await client.query('DROP TABLE IF EXISTS translation_census_matches CASCADE');
    await client.query(`
      CREATE TABLE translation_census_matches (
        author_surname text,
        work_key text,
        language text,
        ustc_english_title text,
        ustc_std_title text,
        author text,
        year int,
        edition_count int,
        catalog_english_title text,
        translator text,
        translation_year text,
        catalog_source text,
        completeness text,
        surname_score real,
        match_score real
      );
    `);

    // Get distinct catalog surnames
    const { rows: surnames } = await client.query(`
      SELECT DISTINCT author_surname_lower AS surname
      FROM translation_catalogs
      WHERE author_surname_lower IS NOT NULL AND author_surname_lower != ''
    `);
    console.log(`  Processing ${surnames.length} catalog surnames...`);

    let totalMatches = 0;
    let processed = 0;
    for (const { surname } of surnames) {
      if (!surname || surname.length < 2) continue;

      const { rowCount } = await client.query(`
        INSERT INTO translation_census_matches
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
          similarity(w.author_surname, $1) AS surname_score,
          GREATEST(
            similarity(lower(w.english_title), lower(regexp_replace(c.english_title, '[^a-z0-9 ]', '', 'g'))),
            CASE WHEN c.canonical_work != '' THEN similarity(w.work_key, lower(regexp_replace(c.canonical_work, '[^a-z0-9 ]', '', 'g'))) ELSE 0 END,
            CASE WHEN c.original_title != '' THEN similarity(w.work_key, lower(regexp_replace(c.original_title, '[^a-z0-9 ]', '', 'g'))) ELSE 0 END
          ) AS match_score
        FROM ustc_distinct_works w
        CROSS JOIN (
          SELECT * FROM translation_catalogs
          WHERE author_surname_lower = $1
            AND english_title IS NOT NULL AND english_title != ''
        ) c
        WHERE (
          w.author_surname = $1
          OR w.author_surname LIKE $1 || '%'
          OR $1 LIKE w.author_surname || '%'
          OR similarity(w.author_surname, $1) > 0.4
        )
        AND (
          similarity(lower(w.english_title), lower(regexp_replace(c.english_title, '[^a-z0-9 ]', '', 'g'))) > 0.2
          OR (c.canonical_work != '' AND similarity(w.work_key, lower(regexp_replace(c.canonical_work, '[^a-z0-9 ]', '', 'g'))) > 0.25)
          OR (c.original_title != '' AND similarity(w.work_key, lower(regexp_replace(c.original_title, '[^a-z0-9 ]', '', 'g'))) > 0.25)
        )
        ORDER BY w.author_surname, w.work_key,
          GREATEST(
            similarity(lower(w.english_title), lower(regexp_replace(c.english_title, '[^a-z0-9 ]', '', 'g'))),
            CASE WHEN c.canonical_work != '' THEN similarity(w.work_key, lower(regexp_replace(c.canonical_work, '[^a-z0-9 ]', '', 'g'))) ELSE 0 END,
            CASE WHEN c.original_title != '' THEN similarity(w.work_key, lower(regexp_replace(c.original_title, '[^a-z0-9 ]', '', 'g'))) ELSE 0 END
          ) DESC
      `, [surname]);

      totalMatches += rowCount || 0;
      processed++;
      if (processed % 200 === 0) {
        console.log(`  ${processed}/${surnames.length} surnames, ${totalMatches.toLocaleString()} matches so far`);
      }
    }

    console.log(`  Raw matches: ${totalMatches.toLocaleString()}`);

    // Deduplicate: keep best match per (author_surname, work_key)
    const { rows: [{ count: beforeDedup }] } = await client.query('SELECT count(*) FROM translation_census_matches');
    await client.query(`
      DELETE FROM translation_census_matches a
      USING translation_census_matches b
      WHERE a.ctid < b.ctid
        AND a.author_surname = b.author_surname
        AND a.work_key = b.work_key;
    `);
    const { rows: [{ count: afterDedup }] } = await client.query('SELECT count(*) FROM translation_census_matches');
    console.log(`  After dedup: ${parseInt(afterDedup).toLocaleString()} (was ${parseInt(beforeDedup).toLocaleString()})`);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_census_matches_surname ON translation_census_matches (author_surname);
      CREATE INDEX IF NOT EXISTS idx_census_matches_lang ON translation_census_matches (language);
      CREATE INDEX IF NOT EXISTS idx_census_matches_key ON translation_census_matches (author_surname, work_key);
    `);

    // Step 3: Summary view by language
    await client.query('DROP MATERIALIZED VIEW IF EXISTS translation_census_by_language CASCADE');
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_census_lang ON translation_census_by_language (language);
    `);

    console.log('  Census views created with indexes');
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
