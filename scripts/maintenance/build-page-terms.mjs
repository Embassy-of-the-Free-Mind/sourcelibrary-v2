#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/repair-entity-page-attribution.mjs (per-book keyset sweep +
// progress log — idioms reused); scripts/batch/batch-generate-indexes.mjs (book-level index via
// Gemini — paid, book grain); src/lib/build-book-index.ts (reads <term> per book for the reader
// index, not queryable across books). None indexes the per-page vocabulary; #4695.
/**
 * build-page-terms — index the vocabulary the OCR and translation prompts ALREADY wrote (#4695).
 *
 *   ocr.data          <vocab>三昧 (Samadhi), λόγος</vocab>        → kind "vocab"    (original language)
 *   translation.data  <term>terma</term> <gloss>treasure</gloss>  → kind "term"     (translator's transliteration + gloss)
 *   translation.data  <keywords>silence, hesychia</keywords>      → kind "keyword"
 *   translation.data  <note>original: "ἡσυχίαν" (hesychian)</note>→ kind "original" (verified against ocr.data; 12% are fabricated, #3308)
 *
 * PASS 1 of two. No model call, no DB write. One JSONL shard per book under --out-dir, one row
 * per (page, kind, term_key). Measured on a 218-book pilot (2026-09-09): 21 rows/page, 10.5
 * DISTINCT terms/page, and the global distinct count grows ~linearly with books (mostly one-off
 * names + OCR noise) — ~70M per-book rows corpus-wide. That is a disk artifact, not an Atlas
 * collection. `aggregate-page-terms.mjs` (pass 2) reduces the shards to the curated global
 * term table and is the only thing that writes to Mongo.
 *
 * Resumable by construction: a book whose shard file exists is skipped (delete the file to
 * redo it). Each book is fetched with retries — the laptop pilot died on an Atlas
 * PoolClearedOnNetworkError after ~1M rows with no retry. Run it on Hetzner, detached:
 *   nohup node --env-file=.env.production.local scripts/maintenance/build-page-terms.mjs \
 *     --out-dir /var/lib/sourcelibrary/page-terms > /var/log/sourcelibrary/page-terms.log 2>&1 &
 *   node scripts/maintenance/build-page-terms.mjs --limit-books 300     # pilot
 *   node scripts/maintenance/build-page-terms.mjs --book <id>           # one book
 *   --concurrency N (default 6) · --out-dir <dir> · --resume-from <bookId>
 *
 * Book iteration is keyset pagination (id > last), never a long-lived cursor — a cursor held
 * across slow work dies with CursorNotFound (see the entity repair sweep's header).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { parseOcrVocab, parseTranslationTerms, CONTEXT_CHARS } from '../lib/page-terms-parse.mjs';

const OCR = { $ifNull: ['$ocr.data', ''] };
const TR = { $ifNull: ['$translation.data', ''] };
// Leading context by substring from the match index — a `.{0,120}<term>` prefix in the regex
// itself cost 36 s on a 1,763-page book (backtracking at every position); this is ~1 s.
const CTX = (idx) => ({ $substrCP: [TR, { $max: [0, { $subtract: [idx, CONTEXT_CHARS] }] }, { $min: [CONTEXT_CHARS, idx] }] });

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const ONLY_BOOK = getArg('--book');
const LIMIT_BOOKS = Number(getArg('--limit-books') || 0);
const RESUME_FROM = getArg('--resume-from');
const OUT_DIR = getArg('--out-dir') || 'scripts/output/page-terms';
const BOOK_PAGE_SIZE = Number(getArg('--page-size') || 200);
const METHOD = 'build-page-terms.mjs@1';
// ocr.language carries these non-values on old pages; fall back to the book's language.
const NON_LANG = new Set(['auto-detect', 'unknown', 'Unknown', '', null, undefined]);

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

fs.mkdirSync(OUT_DIR, { recursive: true });
const shardPath = (bookId) => path.join(OUT_DIR, `${bookId}.jsonl`);
const resumeFrom = RESUME_FROM;

/** Retry transient Atlas/network errors per book instead of dying mid-sweep. */
async function withRetry(fn, label, tries = 6) {
  let delay = 2000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      console.warn(`${label}: ${e.name || 'error'} (${e.message?.slice(0, 80)}) — retry ${i}/${tries - 1} in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

const stats = {
  books: 0, skipped: 0, pages: 0, pagesWithAny: 0, rows: 0,
  byKind: { vocab: 0, term: 0, keyword: 0, original: 0 },
  originalVerified: 0, originalUnverified: 0,
  byLang: {},
};

async function* iterateBooks() {
  if (ONLY_BOOK) {
    const one = await books.findOne({ id: ONLY_BOOK }, { projection: { id: 1, language: 1 } });
    if (one) yield one;
    return;
  }
  let last = resumeFrom || '';
  let n = 0;
  for (;;) {
    const batch = await books
      .find({ id: { $gt: last }, pages_ocr: { $gt: 0 } }, { projection: { id: 1, language: 1 } })
      .sort({ id: 1 })
      .limit(BOOK_PAGE_SIZE)
      .toArray();
    if (!batch.length) return;
    for (const b of batch) {
      yield b;
      n++;
      if (LIMIT_BOOKS && n >= LIMIT_BOOKS) return;
    }
    last = batch[batch.length - 1].id;
  }
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

async function processBook(book) {
  const shard = shardPath(book.id);
  if (fs.existsSync(shard)) { stats.skipped++; return; }
  // Extraction happens INSIDE Mongo: $regexFindAll returns only the tagged substrings (plus
  // CONTEXT_CHARS of leading text for <term> and <note original>, cut by $substrCP from the
  // match index), so a 15 MB book comes back as ~1 MB (measured 17x less egress, 2026-09-10). Original-notes are
  // verified server-side with $indexOfCP against ocr.data, which never leaves the server.
  const bookPages = await withRetry(() => pages.aggregate([
    { $match: { book_id: book.id } },
    { $project: {
      page_number: 1,
      lang: '$ocr.language', opv: '$ocr.prompt_version', tpv: '$translation.prompt_version',
      has_any: { $or: [{ $gt: ['$ocr.data', null] }, { $gt: ['$translation.data', null] }] },
      vocab: { $regexFindAll: { input: OCR, regex: '<vocab>[\\s\\S]*?</vocab>' } },
      terms: { $map: {
        input: { $regexFindAll: { input: TR, regex: '<term(?:\\s[^>]*)?>[\\s\\S]*?</term>(?:\\s*<gloss(?:\\s[^>]*)?>[\\s\\S]*?</gloss>)?' } },
        as: 'm', in: { match: '$$m.match', ctx: CTX('$$m.idx') },
      } },
      keywords: { $regexFindAll: { input: TR, regex: '<keywords>[\\s\\S]*?</keywords>' } },
      notes: { $map: {
        input: { $regexFindAll: { input: TR, regex: `<note(?:\\s[^>]*)?>\\s*original:\\s*["“«']([^"”»']{1,80})["”»'](?:\\s*[(（][^()（）]{1,80}[)）])?` } },
        as: 'n',
        in: { match: '$$n.match', ctx: CTX('$$n.idx'), q: { $arrayElemAt: ['$$n.captures', 0] },
              v: { $gte: [{ $indexOfCP: [OCR, { $arrayElemAt: ['$$n.captures', 0] }] }, 0] } },
      } },
    } },
    { $sort: { page_number: 1 } },
  ], { readPreference: 'secondaryPreferred' }).toArray(), `book ${book.id}`);

  const now = new Date();
  const rows = [];
  for (const p of bookPages) {
    if (!p.has_any) continue;
    stats.pages++;
    const srcLang = (NON_LANG.has(p.lang) ? null : p.lang) || book.language || null;
    const ocrPart = p.vocab.map((m) => m.match).join('\n');
    const trPart = [...p.terms.map((m) => m.ctx + m.match), ...p.keywords.map((m) => m.match), ...p.notes.map((n) => n.ctx + n.match)].join('\n');
    const verified = new Map(p.notes.map((n) => [n.q, n.v]));
    const parsed = [
      ...parseOcrVocab(ocrPart).map((r) => ({ ...r, lang: srcLang, prompt_version: p.opv ?? null, source: 'ocr.data <vocab>' })),
      ...parseTranslationTerms(trPart, null, { verified }).map((r) => ({
        ...r,
        lang: r.kind === 'original' ? srcLang : 'English',
        prompt_version: p.tpv ?? null,
        source: `translation.data <${r.kind === 'original' ? 'note original' : r.kind === 'keyword' ? 'keywords' : 'term'}>`,
      })),
    ];
    if (parsed.length) stats.pagesWithAny++;
    for (const r of parsed) {
      const { source, ...rest } = r;
      rows.push({
        book_id: book.id,
        page_number: p.page_number,
        ...rest,
        field_provenance: { source, method: METHOD, confidence: r.kind === 'original' ? (r.verified ? 0.9 : 0.3) : 0.8, date: now },
      });
      bump(stats.byKind, r.kind);
      if (r.kind === 'original') { if (r.verified) stats.originalVerified++; else stats.originalUnverified++; }
      if (r.kind === 'vocab') bump(stats.byLang, srcLang || 'unknown');
    }
  }

  stats.books++;
  stats.rows += rows.length;

  // Write to a temp name and rename, so a killed run never leaves a truncated shard that
  // the resume check would then treat as done.
  const tmp = shard + '.tmp';
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, shard);

  if (stats.books % 100 === 0) console.log(`${stats.books} books · ${stats.pages} pages · ${stats.rows} rows`);
}

// Small pool: books are independent, and a serial loop leaves the connection idle while
// the client parses. --concurrency 1 for debugging.
const CONCURRENCY = Number(getArg('--concurrency') || 6);
const iter = iterateBooks();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const { value: book, done } = await iter.next();
    if (done) return;
    await processBook(book);
  }
}));

await client.close();

const langs = Object.entries(stats.byLang).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(' · ');
console.log(JSON.stringify({ ...stats, byLang: undefined }, null, 1));
console.log('vocab rows by source language:', langs);
console.log(`shards in ${OUT_DIR} (${stats.skipped} already present, skipped). Next: node scripts/maintenance/aggregate-page-terms.mjs --in-dir ${OUT_DIR}`);
