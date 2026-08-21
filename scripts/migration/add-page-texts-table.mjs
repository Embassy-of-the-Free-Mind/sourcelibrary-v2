#!/usr/bin/env node
/**
 * Apply add-page-texts-table.sql and create the per-language partial HNSW
 * index (#4095, workstream 1).
 *
 * `page_texts` is the language-keyed sibling of `page_translations` — see the
 * header of the .sql for why a sibling and not a `lang` column on the hot
 * table. This runner is idempotent: the DDL is CREATE IF NOT EXISTS / CREATE OR
 * REPLACE, and the vector index is skipped when it already exists.
 *
 * A language's rows are searchable the moment they are embedded; the partial
 * index only makes that search fast. Run with --lang for each language you
 * embed, and re-run it after a large backfill if you built the index first (a
 * partial HNSW built over an empty predicate is valid but has nothing in it —
 * this script reports the row count so you can tell).
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/add-page-texts-table.mjs --lang=es
 *   node --env-file=.env.production.local scripts/migration/add-page-texts-table.mjs --lang=es
 *
 * Env: SUPABASE_DB_URL (secret-lover; the direct-postgres URL, not the REST
 * key — the service-role key cannot run DDL).
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const LANGS = args.filter((a) => a.startsWith('--lang=')).map((a) => a.slice(7));
const DRY_RUN = args.includes('--dry-run');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL (secret-lover get SUPABASE_DB_URL). The service-role key cannot run DDL.');
  process.exit(1);
}

/** ISO 639-1 only — the index name is interpolated into DDL, so validate hard. */
function assertIsoCode(lang) {
  if (!/^[a-z]{2,3}$/.test(lang)) throw new Error(`Not an ISO language code: ${JSON.stringify(lang)}`);
  return lang;
}

async function main() {
  const sql = fs.readFileSync(path.join(HERE, 'add-page-texts-table.sql'), 'utf8');
  const client = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (DRY_RUN) {
      console.log('[dry-run] would apply add-page-texts-table.sql');
    } else {
      await client.query(sql);
      console.log('Applied add-page-texts-table.sql (table + tsv trigger + match_page_texts / match_page_texts_in_books / search_page_texts)');
      // Rows written before the tsv column existed, or before page_text_config
      // learned a language, carry no lexical index entry. The trigger fires on
      // UPDATE, so touching `text` rebuilds them.
      const { rowCount } = await client.query('UPDATE page_texts SET text = text WHERE tsv IS NULL');
      if (rowCount) console.log(`  built tsv for ${rowCount} row(s) that predated the column`);
    }

    for (const raw of LANGS) {
      const lang = assertIsoCode(raw);
      const idx = `page_texts_embedding_${lang}_idx`;
      const { rows: existing } = await client.query(
        'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2', ['page_texts', idx],
      );
      const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM page_texts WHERE lang = $1', [lang]);
      if (existing.length) {
        console.log(`  ${idx}: already present (${n} rows in '${lang}')`);
        continue;
      }
      if (DRY_RUN) { console.log(`  [dry-run] would create ${idx} (${n} rows in '${lang}')`); continue; }
      // Same HNSW parameters as idx_pt_embedding_hnsw on page_translations, so
      // recall behaves the same way across the two stores.
      await client.query(
        `CREATE INDEX ${idx} ON page_texts USING hnsw (embedding vector_cosine_ops)
         WITH (m = 16, ef_construction = 64)
         WHERE lang = '${lang}' AND embedding IS NOT NULL`,
      );
      console.log(`  ${idx}: created over ${n} '${lang}' rows`);
    }

    const { rows } = await client.query(
      `SELECT lang, count(*)::int AS rows, count(embedding)::int AS embedded
       FROM page_texts GROUP BY lang ORDER BY lang`,
    );
    console.log(rows.length ? 'page_texts contents:' : 'page_texts is empty (nothing embedded yet).');
    for (const r of rows) console.log(`  ${r.lang}: ${r.rows} rows, ${r.embedded} with a vector`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
