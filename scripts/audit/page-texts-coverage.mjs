#!/usr/bin/env node
/**
 * Is the non-English text actually FINDABLE? (#4095, workstream 5)
 *
 * Compares three numbers that are easy to confuse and easy to let drift:
 *
 *   counter   books.pages_translated_<lang>   — what the /es band and the cards claim
 *   mongo     pages with translations.<lang>  — what a reader can actually read
 *   supabase  page_texts rows with a vector   — what search can actually find
 *
 * The third is the one nothing else would notice. An unembedded page and a page
 * with no match return the same empty list, which is how the ENGLISH page
 * vectors sat two months dark over 45% of the corpus in Aug 2026. So this
 * script reports the gap per book, and it reports the WRITER, not only the row
 * count: a store whose writer has stopped reads exactly like a healthy one
 * (`measurement-instruments.md` — the dashboard snapshot that served its
 * 2026-04-01 value for 138 days).
 *
 * Staleness is the second failure mode and is specific to this corpus: the
 * Spanish audit→repair loop REWRITES pages, so a row can be present, embedded
 * and wrong. `mongo_updated_at` vs the Mongo source catches it.
 *
 * Usage:
 *   SUPABASE_DB_URL=… node --env-file=.env.production.local \
 *     scripts/audit/page-texts-coverage.mjs --lang=es [--json] [--books]
 *
 * Exit codes: 0 clean, 1 gaps found, 2 could not measure (so a caller cannot
 * mistake "I couldn't reach the DB" for "nothing is missing").
 */
import { MongoClient } from 'mongodb';
import pg from 'pg';
import { pageFilterForLang, pageProjectionForLang } from '../lib/embed-book-page-texts.mjs';
import { pageTextForLang } from '../lib/page-embedding-text.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const m = args.find(a => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d; };
const LANG = arg('lang', 'es');
const AS_JSON = args.includes('--json');
const PER_BOOK = args.includes('--books');
/** A run older than this means the writer has stopped, not that nothing changed. */
const STALE_WRITER_DAYS = parseInt(arg('stale-days', '30'), 10);

if (!/^[a-z]{2,3}$/.test(LANG)) { console.error(`Not an ISO code: ${LANG}`); process.exit(2); }
if (!process.env.MONGODB_URI || !process.env.SUPABASE_DB_URL) {
  console.error('Missing MONGODB_URI or SUPABASE_DB_URL — cannot measure (exit 2, NOT "clean")');
  process.exit(2);
}

const COUNTER = `pages_translated_${LANG}`;

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
  await mc.connect();
  const db = mc.db('bookstore');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 120000');

  try {
    const books = await db.collection('books')
      .find({ [COUNTER]: { $gt: 0 } }, { projection: { id: 1, title: 1, display_title: 1, visible: 1, [COUNTER]: 1 } })
      .toArray();
    const byId = new Map(books.map(b => [b.id, b]));

    // What a reader can read: pages actually carrying text in this language.
    // Counted per book (the book_id index makes this cheap); a corpus-wide
    // count on translations.<lang> is unindexed and would take minutes.
    const mongoPages = new Map();
    for (const b of books) {
      mongoPages.set(b.id, await db.collection('pages').countDocuments({ book_id: b.id, ...pageFilterForLang(LANG) }));
    }

    const { rows: supaRows } = await client.query(
      `SELECT book_id, count(*)::int AS rows, count(embedding)::int AS embedded, max(mongo_updated_at) AS newest
       FROM page_texts WHERE lang = $1 GROUP BY book_id`, [LANG],
    );
    const supa = new Map(supaRows.map(r => [r.book_id, r]));

    // Rows whose Mongo source has been rewritten since they were embedded.
    // Checked per book against the pages collection, because the watermark
    // alone cannot tell you what Mongo says now.
    let staleRows = 0;
    const staleBooks = [];
    for (const r of supaRows) {
      if (!r.newest) { staleRows += r.rows; staleBooks.push({ book_id: r.book_id, reason: 'no watermark' }); continue; }
      const newer = await db.collection('pages').countDocuments({
        book_id: r.book_id, ...pageFilterForLang(LANG),
        $or: [
          { [`translations.${LANG}.updated_at`]: { $gt: r.newest } },
          ...(LANG === 'es' ? [{ 'translation_es.updated_at': { $gt: r.newest } }] : []),
        ],
      });
      if (newer > 0) { staleRows += newer; staleBooks.push({ book_id: r.book_id, reason: `${newer} page(s) re-translated after embedding` }); }
    }

    const rawGaps = books
      .map(b => {
        const s = supa.get(b.id);
        const readable = mongoPages.get(b.id) || 0;
        const findable = s?.embedded || 0;
        return { id: b.id, title: (b.display_title || b.title || b.id).slice(0, 60), counter: b[COUNTER] || 0, readable, findable, gap: readable - findable };
      })
      .filter(r => r.gap > 0);

    // A page whose translation is nothing but editorial wrappers cleans to an
    // empty string and is CORRECTLY absent from the store — serving an empty
    // snippet is worse than serving none. Counting those as gaps would make
    // this check impossible to satisfy, and a check that can never go green is
    // a check people learn to ignore. So classify the difference rather than
    // report it: `empty` is expected, `missing` is work to do.
    let emptyPages = 0;
    const gaps = [];
    for (const g of rawGaps) {
      const { rows: present } = await client.query(
        'SELECT page_id FROM page_texts WHERE book_id = $1 AND lang = $2', [g.id, LANG],
      );
      const have = new Set(present.map(r => r.page_id));
      const candidates = await db.collection('pages')
        .find({ book_id: g.id, ...pageFilterForLang(LANG) }, { projection: pageProjectionForLang(LANG) })
        .toArray();
      let empty = 0, missing = 0;
      for (const p of candidates) {
        if (have.has(p.id)) continue;
        if (pageTextForLang(p, LANG)) missing++; else empty++;
      }
      emptyPages += empty;
      if (missing > 0) gaps.push({ ...g, gap: missing, empty });
    }
    gaps.sort((a, b) => b.gap - a.gap);

    const totals = {
      lang: LANG,
      books: books.length,
      counter: books.reduce((a, b) => a + (b[COUNTER] || 0), 0),
      mongo: [...mongoPages.values()].reduce((a, n) => a + n, 0),
      supabase_rows: supaRows.reduce((a, r) => a + r.rows, 0),
      supabase_embedded: supaRows.reduce((a, r) => a + r.embedded, 0),
      books_with_no_rows: books.filter(b => !supa.has(b.id)).length,
      stale_rows: staleRows,
      // Pages that hold text in this language but nothing QUOTABLE once the
      // editorial wrappers are dropped. Expected, not a defect.
      empty_after_cleaning: emptyPages,
    };

    // The writer check. A store with no writer reads as live.
    const { rows: [{ newest_write }] } = await client.query(
      'SELECT max(mongo_updated_at) AS newest_write FROM page_texts WHERE lang = $1', [LANG],
    );
    const writerAgeDays = newest_write ? (Date.now() - new Date(newest_write)) / 86400000 : null;
    totals.newest_source_write = newest_write ? new Date(newest_write).toISOString() : null;
    totals.writer_age_days = writerAgeDays === null ? null : Math.round(writerAgeDays * 10) / 10;


    if (AS_JSON) {
      console.log(JSON.stringify({ totals, gaps, stale_books: staleBooks }, null, 2));
    } else {
      console.log(`\n${LANG.toUpperCase()} findability — ${totals.books} book(s)`);
      console.log(`  counter (${COUNTER}):    ${totals.counter}`);
      console.log(`  readable (Mongo pages):  ${totals.mongo}${totals.mongo !== totals.counter ? '   ← counter disagrees with the pages' : ''}`);
      console.log(`  findable (page_texts):   ${totals.supabase_embedded} embedded of ${totals.supabase_rows} rows`);
      console.log(`  books with NO rows:      ${totals.books_with_no_rows}`);
      console.log(`  pages with no quotable text once wrappers are dropped (expected): ${totals.empty_after_cleaning}`);
      console.log(`  rows re-translated since embedding (stale snippet + vector): ${totals.stale_rows}`);
      console.log(`  newest source write in the store: ${totals.newest_source_write || 'never'}` +
        (writerAgeDays === null ? '  ← nothing has ever been written'
          : writerAgeDays > STALE_WRITER_DAYS ? `  ← ${totals.writer_age_days}d old; check the writer, not just the count`
            : `  (${totals.writer_age_days}d)`));
      if (gaps.length && PER_BOOK) {
        console.log('\n  per-book gaps (readable − findable):');
        for (const g of gaps) console.log(`    ${String(g.gap).padStart(6)}  ${g.title}  [${g.id}]${g.empty ? ` (+${g.empty} empty after cleaning)` : ''}`);
      } else if (gaps.length) {
        console.log(`\n  ${gaps.length} book(s) with a gap — pass --books to list them.`);
      }
      if (staleBooks.length) {
        console.log(`\n  ${staleBooks.length} book(s) with stale rows — re-run: scripts/workers/embed-page-texts.mjs --lang=${LANG}`);
      }
      console.log('');
    }

    // `books_with_no_rows` is deliberately NOT part of this: a book with no rows
    // whose pages all clean to empty is already counted by `gaps`, and a book
    // that genuinely needs embedding shows up there too. Adding it would double
    // count and, again, make green unreachable.
    const clean = gaps.length === 0 && staleRows === 0;
    process.exitCode = clean ? 0 : 1;
  } finally {
    await client.end();
    await mc.close();
  }
}

main().catch(e => { console.error(e); process.exit(2); });
