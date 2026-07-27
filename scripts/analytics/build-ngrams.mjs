#!/usr/bin/env node
// Build the ngram viewer's frequency tables (issue #3175).
//
// Counts 1–3-grams per (corpus, publication year) across every visible book's
// page text and loads the result into Supabase (`ngram_series`,
// `ngram_totals`), which /api/ngrams serves. Corpora: `en` = English
// translations of everything (plus original OCR of English books with no
// translation layer); per-language originals (`la`, `de`, `el`, …) from OCR.
// See scripts/lib/ngram-normalize.mjs for the corpus list + normalization.
//
// Pipeline (disk-backed map-reduce — the full vocabulary does NOT fit in RAM):
//   emit  — stream books → pages, strip editorial wrappers + apparatus tags,
//           tokenize, count ngrams PER BOOK (small map), append one line per
//           (corpus, ngram) to a hash-picked gzipped shard file, and accumulate
//           per-(corpus, year) token totals.
//   load  — per shard: aggregate lines in memory (1/SHARDS of the vocabulary),
//           drop tails below --min-total occurrences or --min-books distinct
//           books, upsert into Supabase via direct pg. Also derives per-year
//           distinct-book counts (books_by_year — doc-frequency mode, #3217)
//           from the one-line-per-book emit format, so adding that column only
//           needs a load re-run over existing shards, never a recount. Shards are checkpointed
//           in loaded-shards.json, so a killed load resumes where it stopped.
//           Finishes by upserting ngram_totals from the emit's totals.json.
//
// Run (validation, ~300 books):
//   set -a; source .env.production.local; set +a; \
//   node scripts/analytics/build-ngrams.mjs --create-tables --limit 300 \
//     --dir scripts/output/ngrams-test --min-total 3 --min-books 1
//
// Run (full corpus — hours; detach it):
//   NODE_OPTIONS=--max-old-space-size=8192 \
//   nohup node scripts/analytics/build-ngrams.mjs --dir scripts/output/ngrams-build \
//     > scripts/output/ngrams-build.log 2>&1 & disown
//
// Needs: MONGODB_URI, SUPABASE_DB_URL. Zero AI cost. Disk: full 3-gram emit is
// roughly 25–40 GB of gzipped shards under --dir (removable after load).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';
import { getScriptClient } from '../lib/mongo.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import {
  tokenize, stripApparatusTags, ORIGINAL_LANGUAGE_CORPUS, MAX_NGRAM_N,
} from '../lib/ngram-normalize.mjs';

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : def; };
const has = (flag) => process.argv.includes(flag);

const PHASE = arg('--phase', 'all');            // all | emit | load
const DIR = path.resolve(arg('--dir', 'scripts/output/ngrams-build'));
const SHARDS = Number(arg('--shards', 384));
const MAX_N = Math.min(Number(arg('--max-n', MAX_NGRAM_N)), MAX_NGRAM_N);
const MIN_TOTAL = Number(arg('--min-total', 10)); // drop ngrams seen fewer times corpus-wide
const MIN_BOOKS = Number(arg('--min-books', 2));  // …or in fewer distinct books
const LIMIT = Number(arg('--limit', 0));          // 0 = all books (validation runs use small limits)
const LANGUAGE = arg('--language', null);         // validation: restrict to one books.language
const MIN_YEAR = Number(arg('--min-year', 800));
const MAX_YEAR = Number(arg('--max-year', 2030));
const CREATE_TABLES = has('--create-tables');
const TRUNCATE = has('--truncate'); // wipe both tables before a fresh load — REQUIRED when
// replacing a run built with different thresholds/filters, or stale rows from the
// old run survive the upsert (only matching keys get overwritten)
const MAX_PAGE_TOKENS = 15_000; // corpus-size.mjs found ~50k-word junk pages (whole-book dumps); skip them
const MAX_PAGE_CHARS = 200_000; // and skip them BEFORE the wrapper strip: a real dense page is <20K
// chars, and running the cleanup regexes over a 400KB junk dump is what turned
// into a 2h regex spin on 2026-07-18 (regexes now bounded too — defense in depth)

if (!['all', 'emit', 'load'].includes(PHASE)) { console.error(`Unknown --phase ${PHASE}`); process.exit(1); }

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`;

// FNV-1a — stable shard routing (the same key must land in the same shard
// across emit runs; never swap this for a seeded/random hash).
function shardOf(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SHARDS;
}

function countNgrams(tokens, into) {
  const len = tokens.length;
  for (let i = 0; i < len; i++) {
    let gram = tokens[i];
    into.set(gram, (into.get(gram) || 0) + 1);
    for (let n = 2; n <= MAX_N; n++) {
      if (i + n > len) break;
      gram += ' ' + tokens[i + n - 1];
      into.set(gram, (into.get(gram) || 0) + 1);
    }
  }
}

// ---------------------------------------------------------------- emit phase
async function emit() {
  fs.mkdirSync(DIR, { recursive: true });
  // A fresh emit invalidates any previous shards/checkpoints in this dir.
  for (const f of fs.readdirSync(DIR)) {
    if (/^shard-\d+\.tsv\.gz$|^totals\.json$|^loaded-shards\.json$|^meta\.json$/.test(f)) {
      fs.rmSync(path.join(DIR, f));
    }
  }

  const shardStreams = [];
  for (let i = 0; i < SHARDS; i++) {
    const gz = zlib.createGzip({ level: 1 });
    const out = fs.createWriteStream(path.join(DIR, `shard-${String(i).padStart(3, '0')}.tsv.gz`));
    gz.pipe(out);
    shardStreams.push({ gz, out });
  }
  async function writeShard(i, str) {
    if (!shardStreams[i].gz.write(str)) await once(shardStreams[i].gz, 'drain');
  }

  const { client, db } = await getScriptClient({ noTimeout: true });
  const bookFilter = {
    visible: true,
    pages_count: { $gt: 0 },
    year: { $gte: MIN_YEAR, $lte: MAX_YEAR, $type: 'number' },
    // Modern-translation editions are excluded (620 books, ~3.4%): their year
    // is the modern translation's publication date, so a 1911 Jowett Plato
    // would inject a translator's 1911 English at year=1911 — semantically
    // different from every other book, where year = the period edition and our
    // own translation is pinned to it. period-translation stays: a 1650
    // English rendering IS 1650 voice.
    text_role: { $ne: 'modern-translation' },
    ...(LANGUAGE ? { language: LANGUAGE } : {}),
  };
  const books = await db.collection('books')
    .find(bookFilter)
    .project({ id: 1, language: 1, year: 1 })
    .toArray();
  const workList = LIMIT > 0 ? books.slice(0, LIMIT) : books;
  console.log(`[emit] ${workList.length.toLocaleString()} books (of ${books.length.toLocaleString()} eligible), max-n=${MAX_N}, ${SHARDS} shards → ${DIR}`);

  // totals[corpus][year] = { tokens, pages, books }
  const totals = {};
  const bump = (corpus, year, tokens) => {
    const c = (totals[corpus] ??= {});
    const y = (c[year] ??= { tokens: 0, pages: 0, books: 0 });
    y.tokens += tokens;
    y.pages += 1;
    return y;
  };

  let nBooks = 0, nPages = 0, nTokens = 0, nSkippedJunk = 0, nLines = 0;

  const fetchPages = (bookId) => db.collection('pages')
    .find({ book_id: bookId, page_number: { $not: { $lt: 0 } } }) // negative page_number = soft-hidden
    .project({ 'ocr.data': 1, 'translation.data': 1 })
    .toArray();

  let nextPages = workList.length ? fetchPages(workList[0].id) : null;
  const statusPath = path.join(DIR, 'current-book.txt');
  for (let b = 0; b < workList.length; b++) {
    const book = workList[b];
    // Breadcrumb for stall diagnosis: if the process ever wedges (e.g. a
    // pathological page), this names the book it wedged on.
    fs.writeFileSync(statusPath, `${b} ${book.id} year=${book.year} lang=${book.language || '?'}\n`);
    const bookStart = Date.now();
    const pages = await nextPages;
    if (b + 1 < workList.length) nextPages = fetchPages(workList[b + 1].id);

    const origCorpus = ORIGINAL_LANGUAGE_CORPUS[String(book.language || '').toLowerCase()] || null;
    const isEnglish = origCorpus === 'en-orig';
    // corpus → per-book ngram counts
    const perCorpus = new Map();
    const grams = (corpus) => {
      let m = perCorpus.get(corpus);
      if (!m) { m = new Map(); perCorpus.set(corpus, m); }
      return m;
    };
    const contributed = new Map(); // corpus → tokens this book

    const ingest = (raw, corpus) => {
      if (!raw || !corpus) return;
      if (raw.length > MAX_PAGE_CHARS) { nSkippedJunk++; return; }
      const tokens = tokenize(stripApparatusTags(stripEditorialWrappers(raw)), corpus);
      if (!tokens.length) return;
      if (tokens.length > MAX_PAGE_TOKENS) { nSkippedJunk++; return; }
      countNgrams(tokens, grams(corpus));
      bump(corpus, book.year, tokens.length);
      contributed.set(corpus, (contributed.get(corpus) || 0) + tokens.length);
      nTokens += tokens.length;
    };

    for (const page of pages) {
      nPages++;
      const tr = page.translation?.data;
      ingest(tr, 'en');
      const ocr = page.ocr?.data;
      if (!tr && isEnglish) ingest(ocr, 'en'); // English book without a modernized layer still reads in English
      ingest(ocr, origCorpus);
    }

    for (const corpus of contributed.keys()) {
      totals[corpus][book.year].books += 1;
    }

    // Flush this book's counts to shards: one line per (corpus, ngram).
    const buffers = new Map(); // shard index → line chunks
    for (const [corpus, gramMap] of perCorpus) {
      const prefix = corpus + '\x1f';
      for (const [gram, count] of gramMap) {
        const s = shardOf(prefix + gram);
        let buf = buffers.get(s);
        if (!buf) { buf = []; buffers.set(s, buf); }
        buf.push(prefix + gram + '\t' + book.year + '\t' + count + '\n');
        nLines++;
      }
    }
    for (const [s, buf] of buffers) await writeShard(s, buf.join(''));

    nBooks++;
    const bookSecs = (Date.now() - bookStart) / 1000;
    if (bookSecs > 30) console.log(`[emit] slow book ${book.id} (${pages.length} pages) took ${bookSecs.toFixed(0)}s`);
    if (nBooks % 200 === 0 || nBooks === workList.length) {
      const rate = nBooks / ((Date.now() - t0) / 60000);
      const eta = ((workList.length - nBooks) / rate).toFixed(0);
      console.log(`[emit] ${nBooks}/${workList.length} books | ${nPages.toLocaleString()} pages | ${(nTokens / 1e6).toFixed(0)}M tokens | ${(nLines / 1e6).toFixed(0)}M lines | ${elapsed()} elapsed, ~${eta}m left`);
    }
  }

  await Promise.all(shardStreams.map(({ gz, out }) => {
    const done = once(out, 'finish');
    gz.end();
    return done;
  }));
  fs.writeFileSync(path.join(DIR, 'totals.json'), JSON.stringify(totals));
  fs.writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify({
    finishedAt: new Date().toISOString(), books: nBooks, pages: nPages, tokens: nTokens,
    lines: nLines, skippedJunkPages: nSkippedJunk, shards: SHARDS, maxN: MAX_N,
    limit: LIMIT || null, language: LANGUAGE, minYear: MIN_YEAR, maxYear: MAX_YEAR,
  }, null, 2));
  console.log(`[emit] done: ${nBooks} books, ${(nTokens / 1e6).toFixed(0)}M tokens, ${(nLines / 1e6).toFixed(0)}M lines, ${nSkippedJunk} junk pages skipped, ${elapsed()}`);
  await client.close();
}

// ---------------------------------------------------------------- load phase
const DDL = `
CREATE TABLE IF NOT EXISTS ngram_series (
  corpus text NOT NULL,
  ngram text NOT NULL,
  n smallint NOT NULL,
  counts jsonb NOT NULL,
  total_count integer NOT NULL,
  book_count integer NOT NULL,
  books_by_year jsonb,
  PRIMARY KEY (corpus, ngram)
);
-- Doc-frequency mode (#3217): distinct books mentioning the ngram, per year.
-- Nullable so a pre-#3217 table upgrades in place; rows fill in as the load
-- streams shards, and /api/ngrams?mode=docs treats null as not-yet-loaded.
ALTER TABLE ngram_series ADD COLUMN IF NOT EXISTS books_by_year jsonb;
CREATE TABLE IF NOT EXISTS ngram_totals (
  corpus text NOT NULL,
  year smallint NOT NULL,
  tokens bigint NOT NULL,
  pages integer NOT NULL,
  books integer NOT NULL,
  PRIMARY KEY (corpus, year)
);
ALTER TABLE ngram_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngram_totals ENABLE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ngram_series' AND policyname = 'ngram_series_public_read') THEN
    CREATE POLICY ngram_series_public_read ON ngram_series FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ngram_totals' AND policyname = 'ngram_totals_public_read') THEN
    CREATE POLICY ngram_totals_public_read ON ngram_totals FOR SELECT USING (true);
  END IF;
END $pol$;
`;

async function load() {
  const { default: pg } = await import('pg');
  const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await pgc.connect();
  await pgc.query('SET statement_timeout = 0'); // PgBouncer: SET after connect

  if (CREATE_TABLES) {
    await pgc.query(DDL);
    console.log('[load] tables ready (ngram_series, ngram_totals, public-read RLS)');
  }

  const checkpointPath = path.join(DIR, 'loaded-shards.json');
  const loaded = new Set(fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : []);
  if (TRUNCATE) {
    if (loaded.size > 0) {
      console.log(`[load] --truncate skipped: resuming a checkpointed load (${loaded.size} shards already in)`);
    } else {
      await pgc.query('TRUNCATE ngram_series, ngram_totals');
      console.log('[load] truncated ngram_series + ngram_totals');
    }
  }
  const shardFiles = fs.readdirSync(DIR).filter(f => /^shard-\d+\.tsv\.gz$/.test(f)).sort();
  if (!shardFiles.length) { console.error(`[load] no shard files in ${DIR} — run emit first`); process.exit(1); }

  // Totals load FIRST: they're tiny, already final at emit time, and the API
  // 404s the whole corpus without them. Loading them last meant /api/ngrams
  // was dead for the entire multi-hour shard stream after a --truncate
  // (observed live 2026-07-18). With totals in, the viewer works progressively
  // as shards land.
  await loadTotals(pgc);

  let totalRows = 0, totalDropped = 0;
  for (const file of shardFiles) {
    if (loaded.has(file)) continue;
    const agg = new Map(); // "corpus\x1fngram" → { total, books, years: {} }
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(DIR, file)).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const tab1 = line.indexOf('\t');
      const tab2 = line.indexOf('\t', tab1 + 1);
      const key = line.slice(0, tab1);
      const year = line.slice(tab1 + 1, tab2);
      const count = Number(line.slice(tab2 + 1));
      let e = agg.get(key);
      if (!e) { e = { total: 0, books: 0, years: {}, bookYears: {} }; agg.set(key, e); }
      e.total += count;
      e.books += 1; // emit writes exactly one line per (book, corpus, ngram)
      e.years[year] = (e.years[year] || 0) + count;
      // …so lines-per-year = distinct books mentioning the ngram that year
      // (every book has exactly one publication year) — doc frequency (#3217).
      e.bookYears[year] = (e.bookYears[year] || 0) + 1;
    }

    const rows = [];
    for (const [key, e] of agg) {
      if (e.total < MIN_TOTAL || e.books < MIN_BOOKS) { totalDropped++; continue; }
      const sep = key.indexOf('\x1f');
      const ngram = key.slice(sep + 1);
      let n = 1;
      for (let i = 0; i < ngram.length; i++) if (ngram.charCodeAt(i) === 32) n++;
      rows.push([key.slice(0, sep), ngram, n, JSON.stringify(e.years), e.total, e.books, JSON.stringify(e.bookYears)]);
    }
    agg.clear();

    const BATCH = 1000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const params = [];
      const values = chunk.map((r, j) => {
        params.push(...r);
        const o = j * 7;
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4}::jsonb,$${o + 5},$${o + 6},$${o + 7}::jsonb)`;
      });
      await pgc.query(
        `INSERT INTO ngram_series (corpus, ngram, n, counts, total_count, book_count, books_by_year)
         VALUES ${values.join(',')}
         ON CONFLICT (corpus, ngram) DO UPDATE SET
           n = EXCLUDED.n, counts = EXCLUDED.counts,
           total_count = EXCLUDED.total_count, book_count = EXCLUDED.book_count,
           books_by_year = EXCLUDED.books_by_year`,
        params,
      );
    }
    totalRows += rows.length;
    loaded.add(file);
    fs.writeFileSync(checkpointPath, JSON.stringify([...loaded]));
    console.log(`[load] ${file}: ${rows.length.toLocaleString()} rows kept (${loaded.size}/${shardFiles.length} shards, ${totalRows.toLocaleString()} rows total, ${elapsed()})`);
  }

  console.log(`[load] done: ${totalRows.toLocaleString()} series rows (${totalDropped.toLocaleString()} below threshold), ${elapsed()}`);
  await pgc.end();
}

async function loadTotals(pgc) {
  const totals = JSON.parse(fs.readFileSync(path.join(DIR, 'totals.json'), 'utf8'));
  let totalRowCount = 0;
  for (const [corpus, years] of Object.entries(totals)) {
    const rows = Object.entries(years);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const params = [];
      const values = chunk.map(([year, v], j) => {
        params.push(corpus, Number(year), v.tokens, v.pages, v.books);
        const o = j * 5;
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})`;
      });
      await pgc.query(
        `INSERT INTO ngram_totals (corpus, year, tokens, pages, books)
         VALUES ${values.join(',')}
         ON CONFLICT (corpus, year) DO UPDATE SET
           tokens = EXCLUDED.tokens, pages = EXCLUDED.pages, books = EXCLUDED.books`,
        params,
      );
      totalRowCount += chunk.length;
    }
  }
  console.log(`[load] ${totalRowCount} totals rows loaded (up-front)`);
}

// ------------------------------------------------------------------- driver
if (!process.env.MONGODB_URI && PHASE !== 'load') { console.error('Set MONGODB_URI'); process.exit(1); }
if (!process.env.SUPABASE_DB_URL && PHASE !== 'emit') { console.error('Set SUPABASE_DB_URL'); process.exit(1); }

if (PHASE === 'emit' || PHASE === 'all') await emit();
if (PHASE === 'load' || PHASE === 'all') await load();
console.log(`All done in ${elapsed()}`);
process.exit(0);
