#!/usr/bin/env node
/**
 * Apply add-page-translations-withheld.sql, then move the withheld rows (#4523).
 *
 * Two phases, both idempotent:
 *   --ddl    add the four columns and the partial index (safe, additive).
 *   --preserve  BEFORE any move: find rows whose Supabase snippet is LONGER
 *            than the text Mongo currently holds for that page, and write the
 *            snippet to `page_revisions`. Measured on the #4523 set: 66 of
 *            69,434 rows, up to 7,925 characters longer. Mongo is the fuller
 *            copy for the other 69,108, and no page had Supabase as its only
 *            copy — but "almost always" is not the standard for text, so the
 *            exceptions get a snapshot in the collection that is the archive.
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
const PRESERVE = process.argv.includes('--preserve');
const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const ONLY_BOOK = ARG('--book', null);
const ONLY_PAGE = ARG('--page', null);
const BATCH = 2000;

if (!DDL && !MOVE && !UNMOVE && !PRESERVE) { console.error('pass --ddl, --preserve, --move or --unmove'); process.exit(1); }
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

if (PRESERVE) {
  const { randomBytes } = await import('node:crypto');
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');
  const { staleTranslationReason, translationText } = await import('../lib/stale-translation.mjs');

  // Walk the pages that are (or are about to be) withheld, and compare lengths.
  const filter = ONLY_PAGE ? { id: ONLY_PAGE } : {
    ...(ONLY_BOOK ? { book_id: ONLY_BOOK } : {}),
    $or: [
      { 'translation_withheld.reason': { $exists: true } },
      { 'ocr.pipeline': { $exists: true } },
      { 'ocr.unreadable': true },
    ],
  };
  const byId = new Map();
  const cur = db.collection('pages').find(filter, {
    projection: {
      id: 1, book_id: 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1,
      'translation.data': 1, 'translation.updated_at': 1, 'translation.edited_at': 1,
      'translation_withheld.data': 1,
    },
  });
  for await (const p of cur) {
    const live = translationText(p.translation);
    const parked = p.translation_withheld?.data || '';
    if (!parked && !staleTranslationReason(p)) continue;
    byId.set(p.id, { book_id: p.book_id, len: Math.max(live.length, parked.length) });
  }
  console.log(`${byId.size} withheld-or-about-to-be pages`);

  const ids = [...byId.keys()];
  const docs = [];
  for (let i = 0; i < ids.length; i += 5000) {
    const slice = ids.slice(i, i + 5000);
    const r = await pgc.query(
      `select page_id, coalesce(translation_withheld, translation, '') as t
         from page_translations where page_id = any($1::text[])`, [slice]);
    for (const row of r.rows) {
      const mine = byId.get(row.page_id);
      if (!mine || row.t.length <= mine.len) continue;
      docs.push({
        id: randomBytes(6).toString('hex'),
        page_id: row.page_id,
        book_id: mine.book_id,
        field: 'translation',
        data: row.t,
        source: 'ai',
        reason: 'withhold-stale-translation-4523-supabase-snippet',
        created_at: new Date(),
      });
    }
  }
  console.log(`${docs.length} Supabase snippets longer than the Mongo text`);
  if (docs.length && APPLY) {
    const existing = await db.collection('page_revisions')
      .distinct('page_id', { reason: 'withhold-stale-translation-4523-supabase-snippet' });
    const seen = new Set(existing);
    const fresh = docs.filter((d) => !seen.has(d.page_id));
    if (fresh.length) await db.collection('page_revisions').insertMany(fresh, { ordered: false });
    console.log(`wrote ${fresh.length} page_revisions rows (${docs.length - fresh.length} already present)`);
  } else if (docs.length) {
    console.log('dry run — pass --apply to write. Sample:', docs.slice(0, 3).map((d) => `${d.page_id} ${d.data.length}ch`).join(', '));
  }
  await mongo.close();
}

if (MOVE || UNMOVE) {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const filter = ONLY_PAGE
    ? { id: ONLY_PAGE }
    : { 'translation_withheld.reason': { $exists: true }, ...(ONLY_BOOK ? { book_id: ONLY_BOOK } : {}) };
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
