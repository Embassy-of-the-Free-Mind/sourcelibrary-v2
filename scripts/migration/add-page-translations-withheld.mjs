#!/usr/bin/env node
/**
 * Apply add-page-translations-withheld.sql, then move the withheld rows (#4523).
 *
 * Two phases, both idempotent:
 *   --ddl    add the four columns and the partial index (safe, additive).
 *   --move   for every Mongo page whose translation is withheld, park this
 *            table's snippet and vector in the sibling columns and NULL the
 *            served ones. Batched by page id; re-running only moves rows that
 *            have not moved.
 *   --unmove reverse of --move, for the same page ids. Proves the restore.
 *
 * `--move` reads the withheld set FROM MONGO rather than from a file: the set
 * grows with every apply pass and a frozen list is how a takedown leaks.
 *
 * Default is a dry run that prints the counts each phase would change.
 *
 * Usage (Hetzner — SUPABASE_DB_URL is the direct-postgres URL, not the REST key):
 *   node --env-file=.env.production.local scripts/migration/add-page-translations-withheld.mjs --ddl --apply
 *   node --env-file=.env.production.local scripts/migration/add-page-translations-withheld.mjs --move --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MongoClient } from 'mongodb';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const DDL = process.argv.includes('--ddl');
const MOVE = process.argv.includes('--move');
const UNMOVE = process.argv.includes('--unmove');
const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const ONLY_BOOK = ARG('--book', null);
const ONLY_PAGE = ARG('--page', null);
const BATCH = 2000;

if (!DDL && !MOVE && !UNMOVE) { console.error('pass --ddl, --move or --unmove'); process.exit(1); }
if (!process.env.SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL — the service-role REST key cannot run DDL or bulk UPDATE.');
  process.exit(1);
}

const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();

if (DDL) {
  const sql = fs.readFileSync(path.join(HERE, 'add-page-translations-withheld.sql'), 'utf8');
  if (!APPLY) {
    console.log('--ddl dry run; would execute:\n' + sql.split('\n').filter((l) => l && !l.startsWith('--')).join('\n'));
  } else {
    await pgc.query(sql);
    const cols = await pgc.query(
      `select column_name from information_schema.columns
        where table_name='page_translations' and column_name like '%withheld%' order by column_name`);
    console.log('columns now present:', cols.rows.map((r) => r.column_name).join(', '));
  }
}

if (MOVE || UNMOVE) {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const filter = ONLY_PAGE
    ? { id: ONLY_PAGE }
    : { translation_withheld: { $exists: true }, ...(ONLY_BOOK ? { book_id: ONLY_BOOK } : {}) };
  const ids = await mongo.db('bookstore').collection('pages').distinct('id', filter);
  await mongo.close();
  console.log(`${ids.length} withheld page ids from Mongo`);

  let changed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    if (MOVE) {
      const q = `UPDATE page_translations
           SET translation_withheld = COALESCE(translation_withheld, translation),
               embedding_withheld   = COALESCE(embedding_withheld, embedding),
               translation = '',
               embedding = NULL,
               withheld_at = COALESCE(withheld_at, now()),
               withheld_reason = 'stale_after_reocr_4523'
         WHERE page_id = ANY($1::text[])
           AND (embedding IS NOT NULL OR COALESCE(translation,'') <> '')`;
      if (!APPLY) {
        const r = await pgc.query(
          `select count(*)::int as n from page_translations
            where page_id = any($1::text[]) and (embedding is not null or coalesce(translation,'') <> '')`, [slice]);
        changed += r.rows[0].n;
      } else {
        const r = await pgc.query(q, [slice]);
        changed += r.rowCount;
      }
    } else {
      const q = `UPDATE page_translations
           SET translation = COALESCE(translation_withheld, translation),
               embedding = COALESCE(embedding_withheld, embedding),
               translation_withheld = NULL,
               embedding_withheld = NULL,
               withheld_at = NULL,
               withheld_reason = NULL
         WHERE page_id = ANY($1::text[]) AND withheld_at IS NOT NULL`;
      if (!APPLY) {
        const r = await pgc.query(
          `select count(*)::int as n from page_translations where page_id = any($1::text[]) and withheld_at is not null`, [slice]);
        changed += r.rows[0].n;
      } else {
        const r = await pgc.query(q, [slice]);
        changed += r.rowCount;
      }
    }
    if ((i / BATCH) % 5 === 0) process.stdout.write(`  ${Math.min(i + BATCH, ids.length)}/${ids.length}\r`);
  }
  console.log(`\n${MOVE ? 'moved' : 'unmoved'}${APPLY ? '' : ' (would move)'}: ${changed} rows`);

  const check = await pgc.query(
    `select count(*)::int as reachable from page_translations
      where page_id = any($1::text[]) and embedding is not null and coalesce(translation,'') <> ''`,
    [ids.slice(0, 200000)]);
  console.log(`still reachable by the RPCs (embedding + snippet): ${check.rows[0].reachable}`);
}

await pgc.end();
