#!/usr/bin/env node
import pg from 'pg';

const pgUrl = process.env.SUPABASE_DB_URL;
if (!pgUrl) { console.error('SUPABASE_DB_URL required'); process.exit(1); }

const client = new pg.Client(pgUrl);
await client.connect();

await client.query(`
  CREATE OR REPLACE FUNCTION get_sl_progress()
  RETURNS json LANGUAGE sql STABLE AS $fn$
    WITH by_lang AS (
      SELECT language,
        count(*) AS total,
        count(*) FILTER (WHERE pages_translated > 0) AS translated,
        count(*) FILTER (WHERE translation_pct >= 90) AS over_90,
        count(*) FILTER (WHERE is_first_translation) AS first_trans
      FROM books_catalog
      WHERE pages_count > 0 AND language IS NOT NULL
      GROUP BY language
      ORDER BY count(*) DESC
      LIMIT 20
    ),
    by_century AS (
      SELECT
        (floor(year::numeric / 100) * 100)::int AS century_start,
        count(*) AS total,
        count(*) FILTER (WHERE pages_translated > 0) AS translated,
        count(*) FILTER (WHERE translation_pct >= 90) AS over_90,
        count(*) FILTER (WHERE is_first_translation) AS first_trans
      FROM books_catalog
      WHERE pages_count > 0 AND year IS NOT NULL
      GROUP BY floor(year::numeric / 100) * 100
      ORDER BY floor(year::numeric / 100) * 100
    ),
    totals AS (
      SELECT
        count(*) AS total_books,
        count(*) FILTER (WHERE pages_translated > 0) AS books_translated,
        count(*) FILTER (WHERE translation_pct >= 90) AS books_over_90,
        count(*) FILTER (WHERE is_first_translation) AS first_translations
      FROM books_catalog
      WHERE pages_count > 0
    )
    SELECT json_build_object(
      'totals', (SELECT row_to_json(t) FROM totals t),
      'by_language', (SELECT json_agg(row_to_json(l)) FROM by_lang l),
      'by_century', (SELECT json_agg(row_to_json(c)) FROM by_century c)
    )
  $fn$;
`);
console.log('Created get_sl_progress function');

const r = await client.query('SELECT get_sl_progress()');
const d = r.rows[0].get_sl_progress;
console.log('Totals:', JSON.stringify(d.totals));
console.log('\nTop languages:');
for (const l of (d.by_language || []).slice(0, 10))
  console.log('  ' + l.language.padEnd(15) + l.total + ' total, ' + l.first_trans + ' first');
console.log('\nBy century:');
for (const c2 of d.by_century || [])
  console.log('  ' + c2.century_start + 's: ' + c2.total + ' books, ' + c2.translated + ' translated, ' + c2.first_trans + ' first');

await client.end();
