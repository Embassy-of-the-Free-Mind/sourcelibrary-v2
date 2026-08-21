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
 * Selection: every book READABLE in the language — translated into it
 * (`pages_translated_<lang> > 0`) or WRITTEN in it (#4146). The second half
 * matters more than it sounds: a Spanish original has no counter and never
 * will, so a counter-only rule skipped 68 live books holding 19,464 pages,
 * which were visible on /es and unfindable by Spanish search. Its text comes
 * from `pages.ocr` — safe for a language-keyed store ONLY because the book is
 * already that language; see `pageTextForLang`.
 *
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
 * COST — THIS IS BILLED. `gemini-embedding-2-preview` is $0.20 per 1M input
 * tokens on the paid tier, and every GEMINI_API_KEY* in the env is a paid key.
 * At the measured 4.29 chars/token, the 38.6K-page Spanish corpus is ≈29.1M
 * tokens ≈ **$5.83 per full pass**, and `--force` pays it again from scratch.
 * Run `--dry-run` first: it prints the page count, which is the only input the
 * estimate needs. Ask before a bulk run.
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';
import { embeddableEditionFilter, isNativeEditionLanguage } from '../lib/native-edition-language.mjs';
import { embedBookPageTexts, EMBED_MODEL } from '../lib/embed-book-page-texts.mjs';
import { budgetAllowsDispatch } from '../lib/spend-guard.mjs';

/**
 * Measured on the Spanish corpus 2026-08-21 — see .claude/docs/embeddings.md.
 * Used only to show a human a number before spending it; the authority on
 * whether to spend at all is the budget dial below.
 */
const CHARS_PER_TOKEN = 4.29;
const USD_PER_1M_TOKENS = 0.20;
const AVG_EMBED_CHARS = 3200; // capped at 8,000/page; this is the measured mean

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
    // Books readable in LANG: translated into it (the counter) OR written in it
    // (#4146). Selecting on the counter alone skipped 68 live Spanish originals
    // holding 19,464 pages — visible on /es and unfindable by Spanish search,
    // which is indistinguishable from having no matches. A native edition also
    // needs `pages_ocr > 0`, since its text IS the OCR.
    // The rule is imported, not written here: `page-texts-coverage.mjs` has to
    // select the SAME set or its gap number is meaningless, and when this was
    // inline the audit was still on the counter-only rule and blind to every
    // native book it added.
    const match = BOOK ? { id: { $in: BOOK.split(',') } } : embeddableEditionFilter(LANG);
    // Select first, order second — sorting before the limit once picked the
    // shortest books in the library rather than the intended set (2026-08-20).
    let books = await db.collection('books')
      .find(match, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, pages_ocr: 1, [COUNTER]: 1 } })
      .toArray();

    // How many pages this book contributes. A native edition has NO counter and
    // never will, so counting it as 0 would understate the bill on exactly the
    // books #4146 adds — and this file's own rule is to say the number before
    // spending it, not after.
    const pageLoad = (b) => (b[COUNTER] || 0) || (isNativeEditionLanguage(b.language, LANG) ? (b.pages_ocr || 0) : 0);

    books.sort((a, b) => pageLoad(a) - pageLoad(b));
    if (LIMIT) books = books.slice(0, LIMIT);

    const expected = books.reduce((a, b) => a + pageLoad(b), 0);
    // Say the number BEFORE spending it. This worker was written believing the
    // model was free-tier, and a full pass plus a --force repeat cost ~$11.65
    // before anyone was asked (#4095). An estimate printed after the fact is
    // an apology; printed first, it is a decision.
    const estUsd = expected * AVG_EMBED_CHARS / CHARS_PER_TOKEN / 1e6 * USD_PER_1M_TOKENS;
    console.log(
      `[${LANG}] ${books.length} book(s), ${expected} pages (counter, or OCR pages for a native edition)` +
      `${DRY_RUN ? ' — DRY RUN' : ''}${FORCE ? ' — FORCE (re-embeds pages that are already current)' : ''}\n` +
      `[${LANG}] estimated cost ≈ $${estUsd.toFixed(2)} (paid tier, $${USD_PER_1M_TOKENS}/1M tokens at ${CHARS_PER_TOKEN} chars/token)`,
    );

    // PREFLIGHT the key on ONE call before walking 175 books.
    //
    // A bad key does not fail the run — it fails each book, so an auth problem
    // arrives as 175 identical JSON blobs and reads like a corpus problem. That
    // happened on 2026-08-21: `secret-lover run` injects its own stale
    // GEMINI_API_KEY_TIER3, and `node --env-file` does NOT override a variable
    // the parent already set, so the dead key SHADOWS the working one sitting in
    // .env.production.local. Every call 400'd, nothing was spent, and the log
    // looked like every Spanish book had broken at once.
    if (!DRY_RUN) {
      const probe = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: 'ok' }] } }),
          signal: AbortSignal.timeout(20000),
        },
      ).catch((e) => ({ ok: false, statusText: e.message }));
      if (!probe.ok) {
        console.error(
          `[${LANG}] the embedding key is not usable (…${String(GEMINI_KEY).slice(-6)}): ${probe.status || probe.statusText}.\n` +
          `[${LANG}] If you launched under \`secret-lover run\`, its stored GEMINI_API_KEY_TIER3 shadows the one in\n` +
          `[${LANG}] .env.production.local — node --env-file will not override a var the parent already set.`,
        );
        process.exitCode = 1;
        return;
      }
    }

    // The same brake embed-gemini.mjs uses. A paid bulk writer that does not
    // consult the dial is a hole in it. Since #4162 this worker also RECORDS
    // what it spends (one gemini_usage row per book), so the dial accounts for
    // embedding rather than only braking on OCR and translation.
    if (!DRY_RUN) {
      const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
      if (!await budgetAllowsDispatch(db, `embed-page-texts:${LANG}`, { control })) {
        console.log(`[${LANG}] daily budget reached or unreadable — not embedding.`);
        return;
      }
    }

    const totals = { embedded: 0, restaled: 0, missing: 0, alreadyPresent: 0 };
    let done = 0;
    const t0 = Date.now();

    for (const book of books) {
      const label = (book.display_title || book.title || book.id).slice(0, 48);
      if (DRY_RUN) {
        const { rows: [{ n }] } = await client.query(
          'SELECT count(*)::int AS n FROM page_texts WHERE book_id = $1 AND lang = $2', [book.id, LANG],
        );
        console.log(`[${LANG}] ${label} — expects ${pageLoad(book)}${isNativeEditionLanguage(book.language, LANG) ? " (native, from OCR)" : ""}, already in page_texts: ${n}`);
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
