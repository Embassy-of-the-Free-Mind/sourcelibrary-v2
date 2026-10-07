#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/embedding-coverage.mjs asks whether each store is still being WRITTEN
 * and how much it holds — never whether a held vector is true. scripts/audit/clip-index-integrity.mjs
 * is the shape followed here (index truth, exit contract), but for CLIP book pointers only.
 * embed-gemini.mjs --restale compares timestamps, which cannot see a vector made by another model
 * or from another text. scripts/eval/embed-format/compat.mjs (#6170) and
 * scripts/eval/embed-models/score.mjs (#6172) re-embed a pool for an eval and stop at a histogram.
 *
 * page-vector-truth — is each stored page vector the embedding of its page, by the model its row
 * names? (#6175)
 *
 * WHY. Search, the Librarian and the MCP trust that `page_translations.embedding` is the
 * gemini-embedding-2-preview vector of the page's text. When it is not, the page silently cannot
 * be found: an unreachable page and a page nothing matches return the same empty list. Found
 * 2026-10-07: e5-base vectors under a Gemini label (14 of 389 books in one sample), and a large
 * band of rows whose vector was made from text the row no longer holds.
 *
 * PER SAMPLED ROW (default 3 rows per book, chosen by md5(page_id || seed)):
 *   model-free  dims / NaN / zero / norm, e5 signature (vector-truth.mjs), the Mongo page exists,
 *               same book_id, same page_number, source newer than mongo_updated_at (stale),
 *               a snippet still served after the Mongo translation was removed, snippet starting with the page's AI
 *               summary (the #2232 misquote class), duplicate vectors within the sample and,
 *               with --dup-probe N, against the whole table through the HNSW index.
 *   paid        a fresh embed of what a writer would compose NOW (pageEmbeddingInput) and the
 *               cosine to the stored vector: < 0.5 off-space, < 0.99 drifted, else ok.
 *   --explain   for drifted rows, also embed the stored snippet and the pre-2026-05-30 text
 *               (tags stripped, editorial-wrapper prose kept) to say WHICH text the vector was
 *               made from. Realtime, so keep it to small runs.
 *
 * EMBED MODES. --embed realtime (default; small runs, the weekly cron), --embed none (model-free
 * checks only, $0), --embed batch (corpus runs: --submit writes ONE Gemini Batch job and a state
 * file, --collect STATE reads the results; half price). Spend is recorded on gemini_usage
 * (endpoint audit/page-vector-truth), one row per run or job, no book_id (a row per book would
 * be 23K usage rows and the spend guard fails closed above 40K/day).
 *
 * POSITIVE CONTROL. --plant adds synthetic defects to the sample IN MEMORY (an e5-shaped vector,
 * a zero vector, NaN, 512 dims, a vector copied from another page, a wrong book_id, a stale
 * watermark, an unrelated vector) and exits 2 unless every one is caught. Writes nothing.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/page-vector-truth.mjs --books 200 --seed 1 --plant
 *   node … --books 200 --seed $(date +%G%V) --json /tmp/pvt.json          # weekly cron shape
 *   node … --all --pages-per-book 3 --embed batch --submit --state /tmp/pvt-state.json
 *   node … --collect /tmp/pvt-state.json --json /tmp/pvt.json
 *   node … --books 300 --untranslated 300 --explain
 *
 * EXIT 0 clean · 1 found a fixable defect over threshold · 2 could not run / probe broke.
 * --file-issue: on 1, file or update the "Page vector truth: " issue; on 0, close it with the
 * clean report. Never on 2 (a broken instrument is not a finding).
 * READ-ONLY on Supabase and Mongo, except gemini_usage rows.
 */
import { MongoClient } from 'mongodb';
import pg from 'pg';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pageEmbeddingInput, cleanPageText, embedTexts, EMBED_MODEL, EMBED_DIMS } from '../lib/page-embedding-text.mjs';
import { newEmbedUsage, logEmbeddingUsage, estimateTextTokens, usdForTokens } from '../lib/embedding-usage.mjs';
import { uploadBatchInputFile, createThenDeleteInput, streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';
import {
  parseVector, cosine, e5Signature, vectorShapeProblems, cosineClass, wilson, e5CentroidLiteral, E5_SIGNATURE_MAX_DISTANCE,
  GEMINI_TEXT_MODELS,
} from '../lib/vector-truth.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const has = (n) => args.includes(n);
const NBOOKS = Number(flag('--books', 0));
const ALL = has('--all');
const NUNTRANSLATED = Number(flag('--untranslated', 0));
const PER_BOOK = Number(flag('--pages-per-book', 3));
const SEED = String(flag('--seed', 'pvt'));
const EMBED = flag('--embed', 'realtime');
const SUBMIT = has('--submit');
const COLLECT = flag('--collect', null);
const STATE = flag('--state', '/tmp/page-vector-truth-state.json');
const EXPLAIN = has('--explain');
const PLANT = has('--plant');
const DUP_PROBE = Number(flag('--dup-probe', 0));
const JSON_OUT = flag('--json', null);
const BOOK_IDS_FILE = flag('--book-ids', null); // re-check a fixed list (after a repair)
const CONCURRENCY = Number(flag('--concurrency', 4));
const JOB_TEXTS = Number(flag('--job-texts', 20000));
// Measured on #5729: with more than ~3 embedding batch jobs running in the project, Gemini
// cancels most requests of the later ones. Other lanes submit too, so stay under that.
const MAX_RUNNING = Number(flag('--max-running', 2));
const FILE_ISSUE = has('--file-issue');
const E5_SCAN = has('--e5-scan');          // with --book-ids: every row of those books, e5 signature, server-side
const PAGES_OUT = flag('--pages-out', null);
const RESUBMIT = flag('--resubmit', null); // a state file whose sample was taken but whose jobs never got created // --e5-scan: write the e5 page ids (JSON) for embed-gemini --pages-file
// Thresholds: books in the sample with at least one row of the class.
const MAX_OFF_SPACE_BOOKS = Number(flag('--max-off-space-books', 0));
const MAX_SHAPE_ROWS = Number(flag('--max-shape-rows', 0));
const MAX_WRONG_BOOK_ROWS = Number(flag('--max-wrong-book-rows', 0));
const MAX_SUMMARY_LEAK_ROWS = Number(flag('--max-summary-leak-rows', 0));
const MAX_DUP_ROWS = Number(flag('--max-dup-rows', 0));
const ISSUE_PREFIX = 'Page vector truth: ';

/**
 * The text the page writer embedded BEFORE 2026-05-30 (#2232): tags stripped, but the prose
 * INSIDE editorial wrappers (<meta>, <summary>, <image-desc>, …) kept. Rows written then still
 * carry that vector; `backfill-clean-snippets.mjs` later re-derived their snippet column with the
 * current cleaner and deliberately left the vector alone. Used to EXPLAIN drift, never to write.
 */
function legacyTagStripText(text) {
  return typeof text === 'string' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000) : '';
}

let STATE_OVERRIDE = null;
const BATCH_API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const log = (s) => console.error(s);

if (!process.env.MONGODB_URI || !process.env.SUPABASE_DB_URL) { log('Need MONGODB_URI and SUPABASE_DB_URL'); process.exit(2); }
if (EMBED !== 'none' && !KEY) { log('Need GEMINI_API_KEY_TIER3 or GEMINI_API_KEY (or --embed none)'); process.exit(2); }
if (!COLLECT && !RESUBMIT && !ALL && !NBOOKS && !NUNTRANSLATED && !BOOK_IDS_FILE) { log('Pass --books N, --all, --untranslated N, --book-ids FILE or --collect STATE'); process.exit(2); }

const PAGE_PROJECTION = {
  id: 1, book_id: 1, page_number: 1, updated_at: 1, translation_summary: 1, translation_keywords: 1,
  'translation.data': 1, 'translation.updated_at': 1, 'ocr.data': 1, 'ocr.updated_at': 1,
};
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db('bookstore');
const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await sql.connect();
await sql.query("SET statement_timeout = '120s'");

let exitCode = 0;
try {
  exitCode = E5_SCAN ? await e5Scan() : RESUBMIT ? await resubmitFromState() : COLLECT ? await collectRun() : await sampleRun();
} catch (e) {
  log(`ERROR page-vector-truth: ${e.stack || e.message}`);
  exitCode = 2;
} finally {
  await sql.end().catch(() => {});
  await mongo.close().catch(() => {});
}
process.exit(exitCode);

// ── e5 scan: every row of the listed books, $0 ───────────────────────

/**
 * The repair list. A 3-row sample finds a BOOK with e5 rows; this finds every e5 row in it, with
 * the signature computed in Postgres so no vector crosses the wire. One book per statement, so a
 * slow book cannot hold a long transaction on the busiest table.
 */
async function e5Scan() {
  if (!BOOK_IDS_FILE) throw new Error('--e5-scan needs --book-ids FILE');
  const ids = JSON.parse(fs.readFileSync(BOOK_IDS_FILE, 'utf8')).map(String);
  const centroid = e5CentroidLiteral();
  const pages = [], perBook = {};
  let rows = 0;
  for (const [i, id] of ids.entries()) {
    const { rows: r } = await sql.query(
      `SELECT page_id, (embedding <=> $2::vector) < $3 AS e5 FROM page_translations
        WHERE book_id = $1 AND embedding IS NOT NULL AND vector_dims(embedding) = 768`, [id, centroid, E5_SIGNATURE_MAX_DISTANCE]);
    rows += r.length;
    const hit = r.filter(x => x.e5).map(x => x.page_id);
    if (hit.length) { perBook[id] = { e5: hit.length, rows: r.length }; pages.push(...hit); }
    if ((i + 1) % 50 === 0) log(`  scanned ${i + 1}/${ids.length} books, ${pages.length.toLocaleString()} e5 rows`);
  }
  if (PAGES_OUT) fs.writeFileSync(PAGES_OUT, JSON.stringify(pages));
  const out = { books_scanned: ids.length, rows_scanned: rows, e5_rows: pages.length, books_with_e5: Object.keys(perBook).length, per_book: perBook };
  console.log(JSON.stringify(out, null, 1));
  if (!rows) { log('FAIL: scanned zero rows — the probe is broken'); return 2; }
  return pages.length ? 1 : 0;
}

// ── Sampling + model-free checks ─────────────────────────────────────

async function pickBooks() {
  const live = { visible: true, pages_count: { $gt: 0 } };
  const books = [];
  if (BOOK_IDS_FILE) {
    for (const id of JSON.parse(fs.readFileSync(BOOK_IDS_FILE, 'utf8'))) books.push({ id: String(id), stratum: 'listed' });
    return books;
  }
  const pick = async (match, n, stratum) => {
    const all = await db.collection('books').find({ ...live, ...match }, { projection: { id: 1 } }).toArray();
    // Seeded order, so a sample is reproducible and the weekly seed changes the draw.
    const ordered = all.map(b => ({ id: String(b.id), k: sha(SEED + b.id) })).sort((a, b) => (a.k < b.k ? -1 : 1));
    log(`${stratum}: ${all.length.toLocaleString()} live books in frame`);
    return { frame: all.length, picked: (n ? ordered.slice(0, n) : ordered).map(b => ({ id: b.id, stratum })) };
  };
  const frames = {};
  if (ALL || NBOOKS) { const r = await pick({ pages_translated: { $gt: 0 } }, ALL ? 0 : NBOOKS, 'translated'); frames.translated = r.frame; books.push(...r.picked); }
  if (NUNTRANSLATED) { const r = await pick({ $or: [{ pages_translated: 0 }, { pages_translated: { $exists: false } }], pages_ocr: { $gt: 0 } }, NUNTRANSLATED, 'untranslated'); frames.untranslated = r.frame; books.push(...r.picked); }
  books.frames = frames;
  return books;
}

async function sampleRows(books) {
  const rows = [];
  let next = 0, done = 0, noRows = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query("SET statement_timeout = '120s'");
    try {
      while (next < books.length) {
        const b = books[next++];
        // Pick ids first, then fetch: in one statement Postgres detoasts every vector and
        // snippet of the book before the sort keeps three (measured: ~40 books/min, 10x slower).
        const { rows: ids } = await client.query(
          `SELECT page_id FROM page_translations WHERE book_id = $1 AND embedding IS NOT NULL
            ORDER BY md5(page_id || $2) LIMIT $3`, [b.id, SEED, PER_BOOK]);
        const { rows: r } = ids.length ? await client.query(
          `SELECT page_id, book_id, page_number, translation, embedding::text AS e, embedding_model, mongo_updated_at
             FROM page_translations WHERE page_id = ANY($1)`, [ids.map(x => x.page_id)]) : { rows: [] };
        if (!r.length) noRows++;
        for (const x of r) rows.push({ ...x, stratum: b.stratum, sampled_book: b.id });
        if (++done % 1000 === 0) log(`  sampled ${done.toLocaleString()}/${books.length.toLocaleString()} books, ${rows.length.toLocaleString()} rows`);
      }
    } finally { await client.end().catch(() => {}); }
  }));
  return { rows, noRows };
}

async function loadPages(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 1000) {
    const ps = await db.collection('pages').find({ id: { $in: ids.slice(i, i + 1000) } }).project(PAGE_PROJECTION).toArray();
    for (const p of ps) out.set(p.id, p);
  }
  return out;
}

/** Model-free findings for one row. Mutates r: r.flags (array), r.vec, r.target. */
function freeChecks(r, page) {
  r.flags = [];
  if (r.e !== undefined) r.vec = parseVector(r.e); // planted copies arrive with r.vec already set
  delete r.e;
  for (const p of vectorShapeProblems(r.vec, { dims: EMBED_DIMS })) r.flags.push(p === 'e5-signature' ? 'e5-signature' : `shape:${p}`);
  r.e5sig = r.vec && r.vec.length === EMBED_DIMS ? +e5Signature(r.vec).toFixed(3) : null;
  if (!GEMINI_TEXT_MODELS.includes(r.embedding_model)) r.flags.push(`label:${r.embedding_model}`); // GA and preview: one space (#6170)
  if (!page) { r.flags.push('page-missing'); return; }
  if (String(page.book_id) !== String(r.book_id)) r.flags.push('wrong-book');
  if (page.page_number !== r.page_number) r.flags.push('page-number-drift');
  const src = page.translation?.updated_at || page.ocr?.updated_at || page.updated_at;
  if (src && (!r.mongo_updated_at || new Date(src) > new Date(r.mongo_updated_at))) r.flags.push('stale');
  if (r.translation && !(typeof page.translation?.data === 'string' && page.translation.data.trim())) {
    // The translation is gone from Mongo but the row still carries a snippet. Harmless when the
    // snippet IS the page's own text (an English original whose self-"translation" was dropped);
    // a defect when it is not — search keeps quoting a translation the book no longer has.
    const own = cleanPageText(page.ocr?.data, { maxChars: 50000 });
    r.flags.push(own && r.translation === own ? 'snippet-is-ocr' : 'removed-translation-served');
  }
  const sum = typeof page.translation_summary === 'string' ? page.translation_summary.trim() : '';
  if (sum.length >= 20 && r.translation && r.translation.startsWith(sum.slice(0, 40))) r.flags.push('summary-in-snippet');
  const input = pageEmbeddingInput(page);
  r.target = input?.text || null;
  if (!input) r.flags.push('no-source-text'); // a vector for a page that has no text to embed now
  if (input?.hasTranslation && r.translation !== input.text.slice(0, 50000)) r.flags.push('snippet-differs');
  r.has_translation = !!input?.hasTranslation;
}

function sampleDuplicates(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.vec) continue;
    const k = sha(Buffer.from(Float32Array.from(r.vec).buffer));
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  for (const group of by.values()) {
    if (group.length < 2) continue;
    // Identical text legitimately gives an identical vector (blank leaves, repeated plates).
    const texts = new Set(group.map(r => r.target ?? r.translation ?? r.snip_hash));
    if (texts.size > 1) for (const r of group) r.flags.push('dup-vector');
  }
}

async function probeDuplicates(rows) {
  let probed = 0;
  for (const r of rows.filter(x => x.vec && x.vec.length === EMBED_DIMS).slice(0, DUP_PROBE)) {
    const { rows: nn } = await sql.query(
      `SELECT page_id, book_id, left(translation, 300) t, embedding <=> $1::vector AS d
         FROM page_translations WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector LIMIT 4`, [JSON.stringify(Array.from(r.vec))]);
    // The WHERE is not decoration: idx_pt_embedding_hnsw is PARTIAL on it, and without it the
    // planner seq-scans 7M rows (measured 2026-10-07: > 120 s, cancelled).
    probed++;
    // Same text gives the same vector legitimately; compare against the composed text when the
    // snippet itself was dropped to save memory.
    const own = (r.translation ?? r.target ?? '').slice(0, 300);
    const copies = nn.filter(n => n.page_id !== r.page_id && Number(n.d) < 1e-6 && n.t !== own);
    if (copies.length) { r.flags.push('dup-vector'); r.dup_of = copies.map(c => c.page_id); }
  }
  return probed;
}

// ── Positive control ─────────────────────────────────────────────────

function plant(rows) {
  const donors = rows.filter(r => r.vec && r.vec.length === EMBED_DIMS && r.target);
  if (donors.length < 9) throw new Error('--plant needs at least 9 sampled rows with a vector and text');
  const planted = [];
  const clone = (r, tag, mut) => { const c = { ...r, flags: [], planted: tag, page_id: `${r.page_id}#${tag}` }; mut(c); planted.push(c); };
  const src = (s) => { const v = new Array(EMBED_DIMS).fill(0); v[s % EMBED_DIMS] = 1; return v; };
  // An e5-shaped vector: the donor moved onto the e5 mean direction, as every e5-base row is.
  const e5Like = (() => {
    // Always synthesised, never a real e5 row's vector: copying one would make that real row a
    // "duplicate" of the planted copy and put a false finding into the real counts.
    const g = donors[0].vec, out = new Array(EMBED_DIMS);
    let lo = 0, hi = 1;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; mixInto(out, g, m); if (e5Signature(out) > 0.85) hi = m; else lo = m; }
    mixInto(out, g, hi);
    return out;
  })();
  function mixInto(out, g, m) { // out = normalise((1-m) g + m * c) where c is the direction e5Signature measures
    const probe = new Array(EMBED_DIMS).fill(0);
    for (let i = 0; i < EMBED_DIMS; i++) { probe.fill(0); probe[i] = 1; out[i] = e5Signature(probe); }
    const c = out.slice(); for (let i = 0; i < EMBED_DIMS; i++) out[i] = (1 - m) * g[i] + m * c[i];
    const n = Math.hypot(...out); for (let i = 0; i < EMBED_DIMS; i++) out[i] /= n;
  }
  clone(donors[0], 'e5', c => { c.vec = e5Like; });
  clone(donors[1], 'zero', c => { c.vec = new Array(EMBED_DIMS).fill(0); });
  clone(donors[2], 'nan', c => { c.vec = donors[2].vec.slice(); c.vec[5] = NaN; });
  clone(donors[3], 'dims', c => { c.vec = donors[3].vec.slice(0, 512); });
  // One vector on two pages with different text. Both copies are planted, so no real row is
  // dragged into the duplicate group.
  const shared = donors[4].vec.map((x, i) => (x + donors[5].vec[i]) / 2);
  clone(donors[4], 'dup', c => { c.vec = shared; });
  clone(donors[5], 'dup-src', c => { c.vec = shared.slice(); });
  clone(donors[6], 'wrong-book', c => { c.book_id = 'planted-wrong-book'; });
  clone(donors[7], 'stale', c => { c.mongo_updated_at = new Date('2000-01-01'); });
  clone(donors[8], 'unrelated', c => { c.vec = src(17); }); // in-space shape, unrelated content → off-space by cosine
  return planted;
}

function plantCaught(r) {
  const f = r.flags;
  return {
    e5: f.includes('e5-signature'), zero: f.includes('shape:zero'), nan: f.includes('shape:nan'),
    dims: f.some(x => x.startsWith('shape:dims')), dup: f.includes('dup-vector'), 'dup-src': f.includes('dup-vector'),
    'wrong-book': f.includes('wrong-book'), stale: f.includes('stale'),
    unrelated: EMBED === 'none' ? true : r.cls === 'off-space',
  }[r.planted];
}

// ── Fresh embeds ─────────────────────────────────────────────────────

function embeddable(rows) { return rows.filter(r => r.target && r.vec && r.vec.length === EMBED_DIMS && !r.flags.includes('shape:nan') && !r.flags.includes('shape:zero')); }

async function embedRealtime(texts) {
  const usage = newEmbedUsage();
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    out.push(...await embedTexts(texts.slice(i, i + 50), KEY, { usage }));
    if (i && i % 5000 === 0) log(`  embedded ${i.toLocaleString()}/${texts.length.toLocaleString()}`);
  }
  await logEmbeddingUsage(usage, { model: EMBED_MODEL, endpoint: 'audit/page-vector-truth', db });
  return out;
}

async function explain(rows) {
  const drifted = rows.filter(r => r.cls === 'drifted' || r.cls === 'off-space');
  const jobs = [];
  for (const r of drifted) {
    const page = r._page;
    const cands = {
      stored_snippet: (r.translation || '').slice(0, 8000),
      pre_2026_05_30: page ? legacyTagStripText(page.translation?.data) : '',
      // Embedded from the original before the translation landed, and never re-embedded.
      ocr: page ? cleanPageText(page.ocr?.data) : '',
    };
    if (page?.translation_summary || page?.translation_keywords?.length) {
      const meta = [];
      if (page.translation_summary) meta.push(page.translation_summary);
      if (page.translation_keywords?.length) meta.push(`Keywords: ${page.translation_keywords.join(', ')}`);
      cands.summary_prefixed = meta.join('\n') + '\n\n' + r.target;
    }
    for (const [k, t] of Object.entries(cands)) if (t && t !== r.target) jobs.push({ r, k, t });
  }
  if (!jobs.length) return;
  const vecs = await embedRealtime(jobs.map(j => j.t));
  jobs.forEach((j, i) => { (j.r.explain ??= {})[j.k] = +cosine(j.r.vec, vecs[i]).toFixed(4); });
  for (const r of drifted) {
    const best = Object.entries(r.explain || {}).sort((a, b) => b[1] - a[1])[0];
    r.made_from = best && best[1] >= 0.99 ? best[0] : (r.flags.includes('e5-signature') ? 'e5-base' : r.flags.includes('stale') ? 'stale-source' : 'unexplained');
    r.target_len = r.target?.length ?? 0;
    r.cjk_share = r.target ? +((r.target.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length / r.target.length).toFixed(2) : 0;
  }
}

async function sampleRun() {
  const books = await pickBooks();
  log(`${books.length.toLocaleString()} books to sample (${PER_BOOK} rows each, seed ${SEED})`);
  const { rows, noRows } = await sampleRows(books);
  log(`${rows.length.toLocaleString()} rows sampled; ${noRows} books had no vector row`);
  // In chunks, releasing each chunk's pages: a corpus run holds ~78K rows, and keeping every
  // page's full OCR + translation (and 78K vectors as JS arrays) ran out of heap at 1.5 GB.
  const KEEP_TEXT = EXPLAIN || PLANT;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const pages = await loadPages(chunk.map(r => r.page_id));
    for (const r of chunk) {
      const p = pages.get(r.page_id);
      freeChecks(r, p);
      if (KEEP_TEXT) { r._page = p; continue; }
      if (r.vec) r.vec = Float32Array.from(r.vec);
      r.translation_len = r.translation?.length ?? 0;
      r.snip_hash = r.translation ? sha(r.translation).slice(0, 16) : null;
      delete r.translation;
    }
  }
  const planted = PLANT ? plant(rows) : [];
  for (const c of planted) freeChecks(c, c._page);
  const all = [...rows, ...planted];
  sampleDuplicates(all);
  let probed = 0;
  if (DUP_PROBE) probed = await probeDuplicates(rows);

  if (EMBED === 'batch') {
    if (!SUBMIT) throw new Error('--embed batch needs --submit (then --collect STATE)');
    return await submitBatch(rows, books, noRows);
  }
  if (EMBED === 'realtime') {
    const todo = embeddable(all);
    const uniq = [...new Set(todo.map(r => r.target))];
    log(`embedding ${uniq.length.toLocaleString()} texts realtime…`);
    const vecs = await embedRealtime(uniq);
    const byText = new Map(uniq.map((t, i) => [t, vecs[i]]));
    for (const r of todo) { r.cos = +cosine(r.vec, byText.get(r.target)).toFixed(4); r.cls = cosineClass(r.cos); }
    if (EXPLAIN) await explain(rows);
  }
  return finish({ rows, planted, books, noRows, probed });
}

// ── Batch lane (corpus runs) ─────────────────────────────────────────

async function batchState(name) {
  const r = await (await fetch(`${BATCH_API}/${name}?key=${KEY}`)).json().catch(() => ({}));
  return { state: r.metadata?.state || r.state || 'UNKNOWN', stats: r.metadata?.batchStats || {}, responsesFile: r.response?.responsesFile || r.metadata?.output?.responsesFile };
}

async function submitBatch(rows, books, noRows) {
  const todo = embeddable(rows);
  const uniq = [...new Set(todo.map(r => r.target))];
  const tokens = uniq.reduce((s, t) => s + estimateTextTokens(t), 0);
  const estUsd = usdForTokens(tokens, { batch: true });
  log(`batch: ${uniq.length.toLocaleString()} texts, ~${tokens.toLocaleString()} tokens ≈ $${estUsd.toFixed(2)} at batch price, ${Math.ceil(uniq.length / JOB_TEXTS)} job(s)`);
  const slim = rows.map(({ vec, _page, target, ...r }) => ({ ...r, target_key: target ? sha(target).slice(0, 16) : null }));
  const st = { jobs: [], seed: SEED, per_book: PER_BOOK, est_usd: estUsd, frames: books.frames, books: books.length, noRows, rows: slim };
  const save = () => fs.writeFileSync(STATE_OVERRIDE || STATE, JSON.stringify(st));
  save();
  for (let i = 0; i < uniq.length; i += JOB_TEXTS) {
    const chunk = uniq.slice(i, i + JOB_TEXTS);
    for (;;) { // wait for a slot: ours running < MAX_RUNNING
      let running = 0;
      for (const j of st.jobs) if (!/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test((await batchState(j.name)).state)) running++;
      if (running < MAX_RUNNING) break;
      await new Promise(r => setTimeout(r, 60000));
    }
    // toWellFormed: an 8,000-char cut can split a surrogate pair, and the Batch API rejects the
    // whole job on one lone surrogate ("invalid JSON … expected '\\u'"). The key stays the hash
    // of the composed text, so collect still matches it to its rows.
    const body = chunk.map(t => JSON.stringify({ key: sha(t).slice(0, 16), request: { content: { parts: [{ text: t.toWellFormed() }] }, outputDimensionality: EMBED_DIMS } })).join('\n') + '\n';
    const jobId = `pvt-${Date.now().toString(36)}-${i / JOB_TEXTS}`;
    const fileName = await uploadBatchInputFile(body, jobId, KEY);
    const created = await createThenDeleteInput({
      fileName, apiKey: KEY,
      create: async () => {
        // 429 = the project's enqueued-token quota (shared with every other batch lane): wait
        // for running jobs to drain rather than fail the run.
        for (let attempt = 0; ; attempt++) {
          const r = await fetch(`${BATCH_API}/models/${EMBED_MODEL}:asyncBatchEmbedContent?key=${KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: { display_name: jobId, input_config: { file_name: fileName } } }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.name) return j;
          if (r.status === 429 && attempt < 20) { log(`  ${jobId}: 429 (enqueued-token quota) — retry ${attempt + 1} in 3 min`); await new Promise(res => setTimeout(res, 180000)); continue; }
          throw new Error(`batch create ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
        }
      },
    });
    const jt = chunk.reduce((s, t) => s + estimateTextTokens(t), 0);
    await logUsage({ type: 'embedding', mode: 'batch', model: EMBED_MODEL, book_id: null, page_count: chunk.length,
      batch_job_id: jobId, input_tokens: jt, output_tokens: 0, status: 'submitted',
      cost_usd: Math.round(usdForTokens(jt, { batch: true }) * 1e6) / 1e6, endpoint: 'audit/page-vector-truth' }, db);
    st.jobs.push({ name: created.name, jobId, texts: chunk.length });
    save();
    log(`submitted ${jobId} → ${created.name} (${chunk.length.toLocaleString()} texts)`);
  }
  log(`state → ${STATE}. Collect: --collect ${STATE}`);
  console.log(JSON.stringify({ submitted: st.jobs.map(j => j.name), state: STATE, texts: uniq.length, est_usd: +estUsd.toFixed(3) }));
  return 0;
}

/** Rebuild the targets of a saved sample from Mongo and submit them (no re-sampling). */
async function resubmitFromState() {
  const st = JSON.parse(fs.readFileSync(RESUBMIT, 'utf8'));
  if (st.jobs?.length) throw new Error(`${RESUBMIT} already has ${st.jobs.length} job(s) — collect it instead`);
  const rows = st.rows;
  let mismatched = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const pages = await loadPages(chunk.map(r => r.page_id));
    for (const r of chunk) {
      const t = pageEmbeddingInput(pages.get(r.page_id))?.text || null;
      // A page edited since the sample is checked against its new text, and says so.
      if (t && r.target_key && sha(t).slice(0, 16) !== r.target_key) mismatched++;
      r.target = t;
      r.vec = new Float32Array(EMBED_DIMS).fill(1 / Math.sqrt(EMBED_DIMS)); // shape only, for embeddable()
    }
  }
  log(`resubmit: ${rows.length.toLocaleString()} rows rebuilt; ${mismatched} page(s) changed since the sample`);
  for (const r of rows) r.flags ??= [];
  const books = Object.assign(new Array(st.books), { frames: st.frames });
  STATE_OVERRIDE = RESUBMIT;
  return submitBatch(rows, books, st.noRows);
}

async function collectRun() {
  const st = JSON.parse(fs.readFileSync(COLLECT, 'utf8'));
  const fresh = new Map();
  let failed = 0, billed = 0;
  const states = [];
  for (const j of st.jobs) states.push({ ...j, ...(await batchState(j.name)) });
  const notDone = states.filter(j => !/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(j.state));
  if (notDone.length) {
    log(`${notDone.length}/${states.length} job(s) not finished: ${notDone.map(j => `${j.jobId} ${j.state} ${JSON.stringify(j.stats)}`).join('; ')}`);
    console.log(JSON.stringify({ pending: notDone.length }));
    return 3;
  }
  for (const j of states) {
    if (!j.responsesFile) { log(`${j.jobId}: ${j.state}, no results — its texts count as failed`); failed += j.texts; continue; }
    for await (const line of streamBatchResponses(j.responsesFile, KEY)) {
      const v = line.response?.embedding?.values;
      billed += line.response?.usageMetadata?.promptTokenCount || 0;
      if (v) fresh.set(line.key ?? line.metadata?.key, v); else failed++;
    }
  }
  log(`results: ${fresh.size.toLocaleString()} vectors, ${failed} failed requests, ${billed.toLocaleString()} billed tokens`);
  // Stored vectors are re-read now (the state file does not keep them); a row rewritten since
  // the submit is checked against its new self, which is the truth wanted anyway.
  const rows = st.rows;
  const vecs = new Map();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map(x => x.page_id);
    const { rows: got } = await sql.query('SELECT page_id, embedding::text e FROM page_translations WHERE page_id = ANY($1)', [ids]);
    for (const g of got) vecs.set(g.page_id, parseVector(g.e));
  }
  for (const x of rows) {
    x.vec = vecs.get(x.page_id) || null;
    const f = x.target_key ? fresh.get(x.target_key) : null;
    if (x.vec && f && x.vec.length === f.length) { x.cos = +cosine(x.vec, f).toFixed(4); x.cls = cosineClass(x.cos); }
  }
  const actual = usdForTokens(billed, { batch: true });
  return finish({ rows, planted: [], books: Object.assign(new Array(st.books), { frames: st.frames }), noRows: st.noRows, probed: 0,
    batch: { jobs: states.map(j => ({ name: j.name, state: j.state, stats: j.stats })), failed, billed_tokens: billed, usd: +actual.toFixed(4) } });
}

// ── Report ───────────────────────────────────────────────────────────

function finish({ rows, planted, books, noRows, probed, batch = null }) {
  const byStratum = {};
  for (const r of rows) {
    const s = (byStratum[r.stratum] ??= { rows: 0, books: new Set(), cls: {}, clsBooks: {}, flags: {}, flagBooks: {}, made_from: {} });
    s.rows++; s.books.add(r.sampled_book);
    const c = r.cls || (r.flags.includes('e5-signature') ? 'off-space' : 'not-embedded');
    s.cls[c] = (s.cls[c] || 0) + 1;
    (s.clsBooks[c] ??= new Set()).add(r.sampled_book);
    for (const f of new Set(r.flags.map(x => x.replace(/:.*/, '')))) { s.flags[f] = (s.flags[f] || 0) + 1; (s.flagBooks[f] ??= new Set()).add(r.sampled_book); }
    if (r.made_from) s.made_from[r.made_from] = (s.made_from[r.made_from] || 0) + 1;
  }
  const strata = {};
  for (const [k, s] of Object.entries(byStratum)) {
    const nb = s.books.size;
    const pct = (n) => `${(100 * n / nb).toFixed(2)}% [${wilson(n, nb).map(x => (100 * x).toFixed(2)).join('–')}]`;
    strata[k] = {
      frame_books: books.frames?.[k] ?? null, sampled_books: nb, rows: s.rows,
      rows_by_class: s.cls,
      books_with_class: Object.fromEntries(Object.entries(s.clsBooks).map(([c, set]) => [c, { books: set.size, share_ci95: pct(set.size) }])),
      rows_by_flag: s.flags,
      books_with_flag: Object.fromEntries(Object.entries(s.flagBooks).map(([f, set]) => [f, { books: set.size, share_ci95: pct(set.size) }])),
      drift_made_from: Object.keys(s.made_from).length ? s.made_from : undefined,
    };
  }
  const caught = planted.map(p => ({ planted: p.planted, caught: !!plantCaught(p), flags: p.flags, cls: p.cls ?? null }));
  const misses = caught.filter(c => !c.caught);
  const offSpaceBooks = new Set(rows.filter(r => r.cls === 'off-space' || r.flags.includes('e5-signature')).map(r => r.sampled_book));
  const count = (pred) => rows.filter(pred).length;
  const shapeRows = count(r => r.flags.some(f => f.startsWith('shape:')));
  const wrongBook = count(r => r.flags.includes('wrong-book'));
  const leak = count(r => r.flags.includes('summary-in-snippet'));
  const dups = count(r => r.flags.includes('dup-vector'));
  const report = {
    measured_at: new Date().toISOString(), seed: SEED, pages_per_book: PER_BOOK, embed: COLLECT ? 'batch' : EMBED,
    books_requested: books.length, books_without_vector_rows: noRows, rows: rows.length, dup_probes: probed,
    strata, batch, positive_control: PLANT ? { planted: caught.length, missed: misses.map(m => m.planted) } : 'not run',
    off_space_examples: [...offSpaceBooks].slice(0, 25),
    thresholds: { MAX_OFF_SPACE_BOOKS, MAX_SHAPE_ROWS, MAX_WRONG_BOOK_ROWS, MAX_SUMMARY_LEAK_ROWS, MAX_DUP_ROWS },
  };
  console.log(JSON.stringify(report, null, 1));
  if (JSON_OUT) {
    const slim = rows.map(({ vec, _page, target, ...r }) => r);
    fs.writeFileSync(JSON_OUT, JSON.stringify({ ...report, rows: slim, planted: caught }, null, 1));
    log(`rows → ${JSON_OUT}`);
  }
  if (misses.length) { log(`FAIL positive control: missed ${misses.map(m => m.planted).join(', ')}`); return 2; }
  if (!rows.length) { log('FAIL: sampled zero rows — the probe is broken, not the corpus'); return 2; }
  const fails = [];
  if (offSpaceBooks.size > MAX_OFF_SPACE_BOOKS) fails.push(`off-space books ${offSpaceBooks.size} > ${MAX_OFF_SPACE_BOOKS}`);
  if (shapeRows > MAX_SHAPE_ROWS) fails.push(`bad-shape rows ${shapeRows} > ${MAX_SHAPE_ROWS}`);
  if (wrongBook > MAX_WRONG_BOOK_ROWS) fails.push(`wrong-book rows ${wrongBook} > ${MAX_WRONG_BOOK_ROWS}`);
  if (leak > MAX_SUMMARY_LEAK_ROWS) fails.push(`summary-in-snippet rows ${leak} > ${MAX_SUMMARY_LEAK_ROWS}`);
  if (dups > MAX_DUP_ROWS) fails.push(`duplicate-vector rows ${dups} > ${MAX_DUP_ROWS}`);
  const code = fails.length ? 1 : 0;
  log(code ? `FAIL page-vector-truth: ${fails.join('; ')}` : 'PASS page-vector-truth');
  if (FILE_ISSUE) fileIssue(code, fails, report);
  return code;
}

function fileIssue(code, fails, report) {
  const body = `/tmp/page-vector-truth-issue-${process.pid}.md`;
  const block = '```json\n' + JSON.stringify({ strata: report.strata, positive_control: report.positive_control, off_space_examples: report.off_space_examples }, null, 1) + '\n```';
  const day = new Date().toISOString().slice(0, 10);
  try {
    const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--search', `"${ISSUE_PREFIX}" in:title`, '--json', 'number,title'], { encoding: 'utf8' }))
      .filter(i => i.title.startsWith(ISSUE_PREFIX));
    if (code === 1) {
      fs.writeFileSync(body, `Weekly \`scripts/audit/page-vector-truth.mjs\` sample (seed ${report.seed}): **${fails.join('; ')}**.\n\n` +
        `Each class and its repair: off-space / e5-signature → \`page-vector-truth.mjs --e5-scan\` for the page list, then \`embed-gemini.mjs --pages-file <list> --batch\`; summary-in-snippet → the same re-embed (the composer was fixed in #6194); wrong-book / duplicate → investigate the writer first. Background and classes: #6175, \`scripts/eval/experiments/2026-10-07-embedding-vector-truth.md\`.\n\n${block}\n`);
      execFileSync('bash', ['.github/scripts/file-or-update-issue.sh', ISSUE_PREFIX, `${ISSUE_PREFIX}${fails[0]} (${day})`, body, 'search'], { stdio: 'inherit' });
    } else {
      for (const i of open) {
        fs.writeFileSync(body, `This week's sample (seed ${report.seed}) is clean on every fixable class — closing. Reopens by itself if the next run finds one.\n\n${block}\n`);
        execFileSync('gh', ['issue', 'close', String(i.number), '--comment', fs.readFileSync(body, 'utf8')], { stdio: 'inherit' });
      }
    }
  } catch (e) {
    log(`could not file/close the issue: ${e.message}`);
  }
}
