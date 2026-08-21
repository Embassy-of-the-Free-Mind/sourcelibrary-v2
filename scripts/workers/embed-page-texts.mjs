#!/usr/bin/env node
/**
 * Bulk-embed non-English page text into Supabase `page_texts` (#4095).
 *
 * The language-keyed counterpart of `embed-gemini.mjs`. That worker is tuned
 * for the 4.5M-row English table — `--full`, `--incremental`, `--missing-only`,
 * `--restale`, worker sharding, a spend guard — and every one of those modes is
 * written against `page_translations`' single-translation shape. Bolting a
 * `--lang` onto it would mean a second code path through all of them for a
 * store three orders of magnitude smaller. This worker walks books instead,
 * which is the right granularity when a language covers ~100 of them, and
 * shares the composer and the row shape via `page-embedding-text.mjs`.
 *
 * Selection: every book whose `pages_translated_<lang>` counter is above zero.
 * Staleness is always checked (see embed-book-page-texts.mjs); `--force`
 * re-embeds regardless.
 *
 * Usage:
 *   secret-lover run -- node --env-file=.env.production.local \
 *     scripts/workers/embed-page-texts.mjs --lang=es
 *   … --lang=es --book=<id>          one book
 *   … --lang=es --limit=10           first N books (fewest pages first)
 *   … --lang=es --dry-run            count the work, embed nothing
 *   … --lang=es --force              re-embed rows that already exist
 *
 * Env: MONGODB_URI, SUPABASE_DB_URL, GEMINI_API_KEY_TIER3 (or GEMINI_API_KEY).
 *
 * Cost: the embedding model is free-tier; a full 38.6K-page Spanish backfill
 * costs $0 and runs in roughly an hour at ~13 texts/sec.
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';
import { embedBookPageTexts } from '../lib/embed-book-page-texts.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};

const LANG = arg('lang');
const BOOK = arg('book');
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const GEMINI_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

if (!LANG || !/^[a-z]{2,3}$/.test(LANG)) {
  console.error('Usage: embed-page-texts.mjs --lang=<iso> [--book=ID] [--limit=N] [--dry-run] [--force]');
  process.exit(1);
}
if (!MONGODB_URI || !SUPABASE_DB_URL || (!GEMINI_KEY && !DRY_RUN)) {
  console.error('Missing env: MONGODB_URI, SUPABASE_DB_URL, or GEMINI_API_KEY[_TIER3]');
  process.exit(1);
}

const COUNTER = `pages_translated_${LANG}`;

async function main() {
  const mc = new MongoClient(MONGODB_URI, { maxPoolSize: 4 });
  await mc.connect();
  const db = mc.db('bookstore');
  const client = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 60000'); // PgBouncer rejects startup params — SET after connect

  try {
    const match = BOOK ? { id: { $in: BOOK.split(',') } } : { [COUNTER]: { $gt: 0 } };
    // Select first, order second — sorting before the limit once picked the
    // shortest books in the library rather than the intended set (2026-08-20).
    let books = await db.collection('books')
      .find(match, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, [COUNTER]: 1 } })
      .toArray();
    books.sort((a, b) => (a[COUNTER] || 0) - (b[COUNTER] || 0));
    if (LIMIT) books = books.slice(0, LIMIT);

    const expected = books.reduce((a, b) => a + (b[COUNTER] || 0), 0);
    console.log(`[${LANG}] ${books.length} book(s), ${expected} pages by the ${COUNTER} counter${DRY_RUN ? ' — DRY RUN' : ''}`);

    const totals = { embedded: 0, restaled: 0, missing: 0, alreadyPresent: 0 };
    let done = 0;
    const t0 = Date.now();

    for (const book of books) {
      const label = (book.display_title || book.title || book.id).slice(0, 48);
      if (DRY_RUN) {
        const { rows: [{ n }] } = await client.query(
          'SELECT count(*)::int AS n FROM page_texts WHERE book_id = $1 AND lang = $2', [book.id, LANG],
        );
        console.log(`[${LANG}] ${label} — counter ${book[COUNTER] || 0}, already in page_texts: ${n}`);
        continue;
      }
      let r;
      try {
        r = await embedBookPageTexts({ db, pg: client, book, lang: LANG, apiKey: GEMINI_KEY, force: FORCE });
      } catch (e) {
        // One book's failure must be visible, not swallowed into a clean-looking
        // total — absence is not failure, but a recorded skip is not absence.
        console.error(`[${LANG}] ${label} — FAILED: ${e.message}`);
        continue;
      }
      for (const k of Object.keys(totals)) totals[k] += r[k];
      done++;
      console.log(
        `[${LANG}] ${label} — +${r.embedded} embedded` +
        `${r.restaled ? ` (${r.restaled} re-embedded stale)` : ''}` +
        `${r.alreadyPresent ? `, ${r.alreadyPresent} fresh` : ''}` +
        `${r.missing ? `, ${r.missing} without ${LANG} text` : ''}` +
        ` [${done}/${books.length}, ${((Date.now() - t0) / 60000).toFixed(1)} min]`,
      );
    }

    if (!DRY_RUN) {
      const { rows } = await client.query(
        'SELECT count(*)::int AS rows, count(embedding)::int AS embedded FROM page_texts WHERE lang = $1', [LANG],
      );
      console.log(
        `[${LANG}] done — ${totals.embedded} embedded this run ` +
        `(${totals.restaled} stale re-embedded, ${totals.alreadyPresent} already fresh, ${totals.missing} pages had no ${LANG} text). ` +
        `page_texts now holds ${rows[0].rows} '${LANG}' rows, ${rows[0].embedded} with a vector; the counter expects ${expected}.`,
      );
    }
  } finally {
    await client.end();
    await mc.close();
  }
}

main().catch((e) => { console.error(`[${LANG}] fatal`, e); process.exit(1); });
