#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/embed-gemini.mjs --restale — the same per-book scan (Supabase watermark vs the
 * Mongo sub-doc timestamp), but it finds only the stale class, writes no list, and goes straight on to embed.
 * It cannot see the second class #6221 measured (empty snippet on a translated page, no timestamp signal),
 * nor the #6270 rows (archived or vanished pages that keep a served vector). scripts/eval/vector-truth/e5-enum.mjs
 * lists e5 rows through the HNSW index; it says nothing about staleness.
 *
 * enumerate-reembed-6221 — READ-ONLY. Lists, per book, the page_translations rows that:
 *   reembed   (#6221): live book, Mongo page exists with page_number > 0, row not withheld, the embed worker
 *             WOULD write a row for the page (`workerEmbeddingInput` is not null), and either
 *             - stale: the Mongo source (translation.updated_at || ocr.updated_at || updated_at) is newer than
 *               mongo_updated_at, or the row has no watermark (embed-gemini --restale's rule), or
 *             - empty-snippet: the row's `translation` is empty while the worker would write a translation
 *               there (`workerEmbeddingInput(page).hasTranslation`), and the row is not already current.
 *             The recall test (#6221, 2026-10-08) found these two classes lose results (+0.18 R@10 fresh);
 *             the rest of the drift does not.
 *   withdraw  (#6270): a row with a served vector (embedding not null, withheld_at null) whose Mongo page is
 *             archived (page_number <= 0) or no longer exists. Every book, live or not.
 *
 * What the worker would write is asked of the worker's own composer, never of `translation.data` non-empty.
 * The 2026-10-11 re-run listed 12,482 rows after the window; a re-embed of them wrote nothing, because the
 * worker had nothing to embed for ~9.4K (a stub or wrapper-only translation over a stub OCR) and the other
 * 3,040 were current (a stub translation, so the row is correctly the OCR's vector with an empty snippet).
 * Three classes are now COUNTED AND FILED but never listed for re-embed:
 *   no-text            the worker would write no row for the page, yet a vector is served. It is a vector of
 *                      text the page no longer holds (Agrippa 1550 p. 623 carried p. 622's translation).
 *                      A re-embed cannot fix it; withdrawing it is a decision, so it is NOT in withdraw.jsonl.
 *   snippet-no-translation  the row's `translation` is NOT empty while the worker would write an empty one
 *                      (OCR fallback), and the row is not stale by timestamp. A LOWER BOUND: only pages with
 *                      no or a stub Mongo translation are composed, see `candidate` below.
 *   empty-snippet-current   empty-snippet, but the row has the current model and the page's source timestamp:
 *                      `--collect-resume` and `--incremental` skip it, so listing it buys nothing.
 *
 * Outputs under --out DIR:
 *   reembed-NNN.json   page ids (JSON arrays of ≤ --chunk ids) for embed-gemini.mjs --pages-file … --batch.
 *                      Chunked because one $in over 1M ids exceeds Mongo's 16 MB command limit.
 *   withdraw.jsonl     [page_id, book_id, reason, embedding_model] — reason archived | page-missing
 *   unlisted.jsonl     [page_id, book_id, class, live, has_watermark, snippet_chars > 0, embedding_model]
 *                      for the three classes above. Nothing reads this file; it is for a human or an audit.
 *   summary.json       counts by class, live vs not
 *
 * Measured 2026-10-10 (49,776 books, 7.80M rows, 33 min at --concurrency 6): reembed 1,225,122 (stale 1,154,967,
 * empty-snippet 417,119, both 249,851; 97,113 more in books that are not live, left out); withdraw 152,987
 * (archived 145,612, page-missing 7,375). Re-run right before the write window: the stale class grows daily.
 * Measured 2026-10-13, after the window (49,807 books, 7.82M rows, 14 min): reembed 7,199, of which 6,990 have a
 * source newer than the window; the pre-fix rule lists 19,770 on the same day. Unlisted, live books: no-text
 * 10,272 served rows (3,389 still hold a snippet), snippet-no-translation 87,878, empty-snippet-current 0.
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/enumerate-reembed-6221.mjs --out DIR
 *        [--books id,id] [--concurrency 6] [--chunk 100000]
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { workerEmbeddingInput, EMBED_MODEL } from '../lib/page-embedding-text.mjs';

const flag = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = flag('--out');
const ONLY = flag('--books')?.split(',').filter(Boolean) ?? null;
const CONC = Number(flag('--concurrency', 6));
const CHUNK = Number(flag('--chunk', 100000));
if (!OUT) { console.error('--out DIR is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: CONC });
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const live = new Set((await db.collection('books')
  .find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1 } }).toArray()).map(b => String(b.id)));
const bookIds = ONLY ?? (await pool.query('SELECT DISTINCT book_id FROM page_translations')).rows.map(r => r.book_id).sort();
console.log(`${bookIds.length.toLocaleString()} books with rows; ${live.size.toLocaleString()} live books in Mongo`);

const c = { rows: 0, rowsLive: 0, withheld: 0, stale: 0, emptySnippet: 0, both: 0, reembed: 0, reembedNotLive: 0,
  archived: 0, archivedServed: 0, missing: 0, missingServed: 0, books: 0, booksReembed: 0, booksWithdraw: 0,
  // Not listed (see the header). `Live` = the subset in live books.
  noText: 0, noTextServed: 0, noTextServedLive: 0, noTextServedSnippet: 0, noTextServedSnippetLive: 0,
  snippetNoTranslation: 0, snippetNoTranslationLive: 0, emptySnippetCurrent: 0, emptySnippetCurrentLive: 0,
  // The Agrippa 1550 p. 623 shape (#6221, 2026-10-11): a served row with no watermark on a page with no
  // Mongo translation. `Snippet` = the row still holds an English snippet; `NoText` = nothing to re-embed.
  noWatermarkNoTr: 0, noWatermarkNoTrLive: 0, noWatermarkNoTrSnippet: 0, noWatermarkNoTrSnippetLive: 0,
  noWatermarkNoTrNoText: 0, noWatermarkNoTrNoTextLive: 0 };
const reembed = [];
const withdraw = fs.createWriteStream(path.join(OUT, 'withdraw.jsonl'));
const unlisted = fs.createWriteStream(path.join(OUT, 'unlisted.jsonl'));
const FETCH = 500; // page texts per Mongo round-trip
const t0 = Date.now();

async function scan(bookId) {
  const { rows } = await pool.query(
    `SELECT page_id, mongo_updated_at, embedding_model,
            (translation IS NULL OR translation = '') AS empty,
            embedding IS NOT NULL AS served, withheld_at IS NOT NULL AS withheld
       FROM page_translations WHERE book_id = $1`, [bookId]);
  if (!rows.length) return;
  const pages = new Map();
  const cur = db.collection('pages').aggregate([
    { $match: { book_id: bookId } },
    { $project: { _id: 0, id: 1, page_number: 1, ts: { $ifNull: ['$translation.updated_at', { $ifNull: ['$ocr.updated_at', '$updated_at'] }] },
      tr: { $and: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $gt: [{ $strLenBytes: { $ifNull: ['$translation.data', ''] } }, 0] }] } } },
  ]);
  for await (const p of cur) pages.set(String(p.id), p);
  const isLive = live.has(bookId);
  const isStale = (r, p) => Boolean(p.ts) && (!r.mongo_updated_at || new Date(p.ts).getTime() > new Date(r.mongo_updated_at).getTime());
  // The rows whose class depends on what the worker would compose. Composing needs the page text, so it is
  // fetched for these only: stale rows, an empty snippet beside a Mongo translation, a snippet beside none,
  // and the no-watermark rows on untranslated pages. A non-empty snippet beside a STUB Mongo translation is
  // not composed, which is what makes snippet-no-translation a lower bound.
  const candidate = (r, p) => isStale(r, p) || (r.empty ? p.tr : !p.tr) || (!r.mongo_updated_at && !p.tr);
  const want = rows.filter(r => { const p = r.withheld ? null : pages.get(r.page_id); return p && p.page_number > 0 && candidate(r, p); }).map(r => r.page_id);
  const composed = new Map();
  for (let i = 0; i < want.length; i += FETCH) {
    const docs = db.collection('pages').find({ book_id: bookId, id: { $in: want.slice(i, i + FETCH) } },
      { projection: { _id: 0, id: 1, 'translation.data': 1, 'ocr.data': 1 } });
    for await (const d of docs) composed.set(String(d.id), workerEmbeddingInput(d));
  }
  // A page that was asked for and did not come back would read as "nothing to embed" and leave the list
  // without a word. Fail the book instead (it is counted in `errors`).
  const lost = want.filter(id => !composed.has(id));
  if (lost.length) throw new Error(`${lost.length} of ${want.length} page texts not returned (first ${lost[0]})`);
  const file = (r, cls) => unlisted.write(JSON.stringify([r.page_id, bookId, cls, isLive, Boolean(r.mongo_updated_at), !r.empty, r.embedding_model]) + '\n');
  let nRe = 0, nWd = 0;
  for (const r of rows) {
    c.rows++; if (isLive) c.rowsLive++;
    if (r.withheld) { c.withheld++; continue; }
    const p = pages.get(r.page_id);
    if (!p) {
      c.missing++;
      if (r.served) { c.missingServed++; nWd++; withdraw.write(JSON.stringify([r.page_id, bookId, 'page-missing', r.embedding_model]) + '\n'); }
      continue;
    }
    if (!(p.page_number > 0)) {
      c.archived++;
      if (r.served) { c.archivedServed++; nWd++; withdraw.write(JSON.stringify([r.page_id, bookId, 'archived', r.embedding_model]) + '\n'); }
      continue;
    }
    if (!candidate(r, p)) continue;
    const input = composed.get(r.page_id) ?? null;
    if (r.served && !r.mongo_updated_at && !p.tr) {
      c.noWatermarkNoTr++; if (isLive) c.noWatermarkNoTrLive++;
      if (!r.empty) { c.noWatermarkNoTrSnippet++; if (isLive) c.noWatermarkNoTrSnippetLive++; }
      if (!input) { c.noWatermarkNoTrNoText++; if (isLive) c.noWatermarkNoTrNoTextLive++; }
    }
    if (!input) {
      // The worker writes no row for this page, so a re-embed leaves the row exactly as it is.
      c.noText++;
      if (r.served) {
        c.noTextServed++; if (isLive) c.noTextServedLive++;
        if (!r.empty) { c.noTextServedSnippet++; if (isLive) c.noTextServedSnippetLive++; }
        file(r, 'no-text');
      }
      continue;
    }
    const stale = isStale(r, p);
    const emptySnippet = r.empty && input.hasTranslation;
    if (!stale && !r.empty && !input.hasTranslation) { c.snippetNoTranslation++; if (isLive) c.snippetNoTranslationLive++; file(r, 'snippet-no-translation'); }
    // Not stale, so the watermark is at or past the source timestamp: with the current model too, the
    // worker's own "already written" test (--collect-resume, --incremental) skips the row.
    if (!stale && emptySnippet && r.served && r.embedding_model === EMBED_MODEL && r.mongo_updated_at && p.ts) {
      c.emptySnippetCurrent++; if (isLive) c.emptySnippetCurrentLive++; file(r, 'empty-snippet-current');
      continue;
    }
    if (stale) c.stale++;
    if (emptySnippet) c.emptySnippet++;
    if (stale && emptySnippet) c.both++;
    if (!stale && !emptySnippet) continue;
    if (!isLive) { c.reembedNotLive++; continue; }
    c.reembed++; nRe++; reembed.push(r.page_id);
  }
  c.books++; if (nRe) c.booksReembed++; if (nWd) c.booksWithdraw++;
}

let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < bookIds.length) {
    const id = bookIds[next++];
    try { await scan(id); } catch (e) { console.error(`book ${id}: ${e.message}`); c.errors = (c.errors || 0) + 1; }
    if (next % 1000 === 0) console.log(`${new Date().toISOString()} ${next}/${bookIds.length} books, ${c.reembed} reembed, ${c.archivedServed + c.missingServed} withdraw, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}));

await new Promise(res => withdraw.end(res));
await new Promise(res => unlisted.end(res));
for (let i = 0; i * CHUNK < reembed.length; i++) {
  fs.writeFileSync(path.join(OUT, `reembed-${String(i).padStart(3, '0')}.json`), JSON.stringify(reembed.slice(i * CHUNK, (i + 1) * CHUNK)));
}
const summary = { at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), ...c };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await pool.end(); await mongo.close();
