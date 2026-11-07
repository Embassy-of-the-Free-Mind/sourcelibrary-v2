#!/usr/bin/env node
// PRIOR ART: scripts/lib/ia-ocr-cohort.mjs wasRecitationRefused() — the same stamps, read per page to admit Archive
// text, never counted per book. scripts/batch/refused-pages.mjs count — counts blocked pages to READ them, with no
// denominator and no book metadata. scripts/eval/estimator/ocr/failure-observations.jsonl — curated k-of-n rows from
// experiments, not the pipeline's own record. None gives a per-book refused/attempted table with year and fame (#6740).
/**
 * refusal-census — per book: how many pages the OCR lane refused as RECITATION, out of how many it attempted, beside
 * the book's year, language and two measures of how well known its text is. Input to the estimator v1 refusal model
 * (refusal_v1.py), and a dataset in its own right: which printed texts a Gemini reader treats as already online.
 *
 * WHO RUNS IT: a session or job on a Hetzner box (Mongo + the network). Read-only on Mongo; no model calls; $0.
 *
 *   node --env-file=.env.production.local scripts/eval/estimator/ocr/refusal-census.mjs \
 *       --out=DIR [--languages=English,Latin,German,French,Italian] [--max-books=N] [--fame-only]

   --fame-only skips Mongo and (re)builds the two fame files from an existing DIR/books.jsonl.
 *
 * WRITES (all resumable; a rerun skips books already in books.jsonl):
 *   DIR/books.jsonl     one row per book: id, language, year, title, author, ia_identifier, pages, ocr pages,
 *                       refused pages (recitation_count ≥ 1, or the blocked / last_skip stamps), refused-then-read,
 *                       pages per ocr.model, and lite_attempted = pages whose model is flash-lite + refused pages
 *   DIR/ia-downloads.jsonl   {ia_identifier, downloads} from archive.org advancedsearch (batched, 20 quoted ids per call; 50 returns an error object)
 *   DIR/gutenberg.jsonl      {id, gutenberg: [ebook numbers]} — a title + author-surname match against pg_catalog.csv
 *
 * WHAT "REFUSED" MEANS. The stamp is written by realtime-ocr.mjs / the batch collector when Gemini returns
 * finishReason RECITATION. It is a refusal of the lane at the time, not of the page forever: a later engine may have
 * read it (refused_then_read). The denominator is lite's own attempts, so a book OCR'd by another engine first
 * does not dilute the rate.
 *
 * HOW IT FAILS. A Mongo error stops the run; rerun resumes. An archive.org or Gutenberg fetch failure leaves that
 * measure missing (null), never zero: missing fame is not low fame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { publicationYear } from '../../../lib/ia-ocr-cohort.mjs';
import { normalizeLanguageToken } from '../../../lib/language-normalize.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d ?? ''}`).split('=').slice(1).join('=');
const OUT = arg('out');
if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
const LANGS = new Set(arg('languages', 'English,Latin,German,French,Italian').split(','));
const MAX = +arg('max-books', '0') || Infinity;
fs.mkdirSync(OUT, { recursive: true });
const BOOKS = path.join(OUT, 'books.jsonl');
const done = new Set(fs.existsSync(BOOKS) ? fs.readFileSync(BOOKS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);

// RECITATION only, on purpose: this census models lite's recitation refusal against fame. The other failed-read stamps
// in `ocr.last_skip` (refused / empty / timeout / error from every writer, #7378) are counted per route by route-census.mjs.
const REFUSED = { $or: [{ $gte: [{ $ifNull: ['$ocr.recitation_count', 0] }, 1] }, { $eq: ['$ocr.recitation_blocked', true] },
  { $eq: ['$ocr.last_skip.reason', 'recitation'] }] };
const LITE = { $regexMatch: { input: { $ifNull: [{ $toString: '$ocr.model' }, ''] }, regex: 'flash-lite' } };
const HAS_TEXT = { $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, ''] } }, 0] };

export function firstLanguage(book) {
  const raw = Array.isArray(book.language) ? book.language[0] : String(book.language ?? '').split(/[,;/]/)[0];
  return normalizeLanguageToken(raw);
}

/** Lowercased letters-only title key: the first six words of the title before any colon or semicolon. */
export function titleKey(t) {
  return String(t ?? '').split(/[:;]/)[0].toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, ' ').split(/\s+/)
    .filter((w) => w && !['the', 'a', 'an', 'of', 'and'].includes(w)).slice(0, 6).join(' ');
}
const surname = (a) => String(Array.isArray(a) ? a[0] : a ?? '').split(/[,;]/)[0].trim().split(/\s+/).pop()?.toLowerCase()
  .normalize('NFKD').replace(/[^a-z]/g, '') ?? '';

async function census(db) {
  const books = await db.collection('books').find({ pages_count: { $gt: 0 } },
    { projection: { id: 1, language: 1, year: 1, published: 1, title: 1, author: 1, ia_identifier: 1, visible: 1, work_id: 1, pages_count: 1 } }).toArray();
  const pick = books.filter((b) => LANGS.has(firstLanguage(b) ?? '')).filter((b) => !done.has(b.id ?? String(b._id)));
  console.log(`books with pages ${books.length}; in ${[...LANGS].join('/')} and not yet counted ${pick.length}`);
  const out = fs.createWriteStream(BOOKS, { flags: 'a' });
  let i = 0;
  for (const b of pick) {
    if (i >= MAX) break;
    const id = b.id ?? String(b._id);
    const [agg] = await db.collection('pages').aggregate([
      { $match: { book_id: id } },
      { $group: { _id: null, pages: { $sum: 1 }, ocr: { $sum: { $cond: [HAS_TEXT, 1, 0] } },
        refused: { $sum: { $cond: [REFUSED, 1, 0] } }, lite_attempted: { $sum: { $cond: [{ $or: [REFUSED, LITE] }, 1, 0] } },
        refused_read: { $sum: { $cond: [{ $and: [REFUSED, HAS_TEXT] }, 1, 0] } },
        models: { $push: { $ifNull: ['$ocr.model', null] } } } },
    ], { maxTimeMS: 120000 }).toArray();
    const models = {};
    for (const m of agg?.models ?? []) if (m) models[m] = (models[m] ?? 0) + 1;
    out.write(JSON.stringify({ id, language: firstLanguage(b), year: publicationYear(b), title: b.title ?? null,
      author: Array.isArray(b.author) ? b.author.join('; ') : b.author ?? null, ia_identifier: b.ia_identifier ?? null,
      visible: b.visible === true, work_id: b.work_id ?? null, pages: agg?.pages ?? 0, ocr_pages: agg?.ocr ?? 0,
      refused: agg?.refused ?? 0, refused_then_read: agg?.refused_read ?? 0, models,
      // lite's attempts: pages it wrote plus pages it refused (often read later by another engine), each once.
      lite_attempted: agg?.lite_attempted ?? 0 }) + '\n');
    if (++i % 500 === 0) console.log(`  ${i}/${pick.length}`);
  }
  await new Promise((r) => out.end(r));
}

async function iaDownloads() {
  const file = path.join(OUT, 'ia-downloads.jsonl');
  const have = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).ia_identifier) : []);
  const ids = [...new Set(fs.readFileSync(BOOKS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).ia_identifier)
    .filter((x) => typeof x === 'string' && /^[\w.-]+$/.test(x) && !have.has(x)))];
  console.log(`archive.org downloads for ${ids.length} identifiers`);
  const out = fs.createWriteStream(file, { flags: 'a' });
  for (let j = 0; j < ids.length; j += 20) {
    const chunk = ids.slice(j, j + 20);
    // Quoted: an unquoted hyphen ("SutraOfForty-twoSections") is a Solr operator and empties the whole batch.
    const q = encodeURIComponent(`identifier:(${chunk.map((x) => `"${x}"`).join(' OR ')})`);
    try {
      const r = await fetch(`https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=downloads&rows=200&output=json`,
        { signal: AbortSignal.timeout(60000) });
      const body = await r.json();
      // An error object (no `response`) is a failed call, not "none found": write nothing, so a rerun retries.
      if (!body.response) throw new Error(`no response: ${JSON.stringify(body).slice(0, 120)}`);
      const docs = body.response.docs;
      const got = new Map(docs.map((d) => [d.identifier, d.downloads ?? null]));
      // An id the search does not return is unknown (dark or renamed item), not zero downloads.
      for (const x of chunk) out.write(JSON.stringify({ ia_identifier: x, downloads: got.has(x) ? got.get(x) : null, found: got.has(x) }) + '\n');
    } catch (e) {
      console.log(`  chunk ${j}: ${e.message} (left missing)`);
    }
  }
  await new Promise((r) => out.end(r));
}

/** Minimal CSV parser for pg_catalog.csv (quoted fields with embedded commas and newlines). */
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (q) { if (c === '"') { if (text[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

async function gutenberg() {
  const cat = path.join(OUT, 'pg_catalog.csv');
  if (!fs.existsSync(cat)) {
    const r = await fetch('https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv', { signal: AbortSignal.timeout(300000) });
    fs.writeFileSync(cat, await r.text());
  }
  const [head, ...rows] = parseCsv(fs.readFileSync(cat, 'utf8'));
  const col = (n) => head.indexOf(n);
  // By author surname; a title matches when the shorter key is a word prefix of the longer one and has at least three
  // words ("on origin species" vs the catalogue's "on origin species by means natural"), or the keys are equal.
  const bySurname = new Map();
  for (const r of rows) {
    if (r[col('Type')] !== 'Text') continue;
    const sn = surname(r[col('Authors')]);
    if (!sn) continue;
    if (!bySurname.has(sn)) bySurname.set(sn, []);
    bySurname.get(sn).push([titleKey(r[col('Title')]).split(' '), +r[col('Text#')]]);
  }
  const prefixMatch = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return (s.length >= 3 || s.length === l.length) && s.every((w, k) => w === l[k]); };
  const out = fs.createWriteStream(path.join(OUT, 'gutenberg.jsonl'));
  let hits = 0;
  for (const l of fs.readFileSync(BOOKS, 'utf8').split('\n').filter(Boolean)) {
    const b = JSON.parse(l);
    const key = titleKey(b.title).split(' ').filter(Boolean);
    const m = key.length ? (bySurname.get(surname(b.author)) ?? []).filter(([t]) => prefixMatch(key, t)).map(([, n]) => n) : [];
    if (m.length) hits++;
    out.write(JSON.stringify({ id: b.id, gutenberg: m }) + '\n');
  }
  await new Promise((r) => out.end(r));
  console.log(`gutenberg: ${hits} books match a catalogue title + author surname`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv.includes('--fame-only')) {
    const c = await new MongoClient(process.env.MONGODB_URI).connect();
    try { await census(c.db('bookstore')); } finally { await c.close(); }
  }
  await iaDownloads();
  await gutenberg();
}
