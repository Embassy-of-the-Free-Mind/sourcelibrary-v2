#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-v17/build-sample.py (#5698) — draws across all five #5695 tracks by
// language quota and knows nothing of which model a book ships on; #5942 phase 1 needs ONLY pages whose book routes
// to flash-lite today (getTranslateModelForBook, read from Mongo), and none of the pages #5919 used. Its pool rule
// (public reference, source 400–6000 chars, reference cut not judged "wrong") is copied unchanged.
/** Pin the #5942 Lite sample: 40 reference pages from books that ship on gemini-3.1-flash-lite, disjoint from the #5919 pages. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-layer/build-lite-sample.mjs
 *
 * Pool: #5695 T1 (Latin, xlref-t1-2026-10) and T3 (vernaculars, xlref-t3-2026-10) harness records. Kept when the
 * reference is public, the source is 400–6000 chars, neither track judge called the reference cut "wrong", the book
 * routes to Lite now, and the BOOK is not in the #5698/#5919 sample (main or gallery pool). One page per book.
 * Coptic (#5778) also routes to Lite but its records carry no source text and its reference translates the Greek: out.
 * No Tibetan (routes to Flash anyway). Seed 5942 (mulberry32).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { getTranslateModelForBook, MODEL_LITE } from '../../lib/translate-core.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, itemId } from '../translation-vs-reference/common.mjs';

const R = new URL('../results/', import.meta.url).pathname;
const OUT = `${R}notes-layer-2026-10/lite/sample.jsonl`;
const QUOTA = { Latin: 16, German: 8, French: 5, Italian: 5, Dutch: 3, Spanish: 3 };
const used = readJsonl(`${R}translation-prompt-v17-2026-10/sample.jsonl`);
const usedBooks = new Set(used.map((r) => r.book_id));

const pool = [];
for (const [track, dir, resFile] of [['T1', 'xlref-t1-2026-10', 'results-pass1.json'], ['T3', 'xlref-t3-2026-10', 'results.json']]) {
  const fit = new Map(JSON.parse(fs.readFileSync(`${R}${dir}/${resFile}`, 'utf8')).per_page.map((p) => [p.id, p.reference_fit]));
  for (const r of readJsonl(`${R}${dir}/records.jsonl`)) {
    pool.push({ track, lang: r.lang, book_id: r.book_id, page_number: r.page_number, source_text: r.source_text, reference_text: r.reference_text,
      reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head, prior_reference_fit: fit.get(itemId(r)) ?? null });
  }
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db('bookstore').collection('books');
const drop = {}; const kept = [];
for (const r of pool) {
  const why = r.reference_meta?.private ? 'private reference'
    : !(r.source_text?.length >= 400 && r.source_text.length <= 6000) || !r.reference_text ? 'source length outside 400–6000'
    : Object.values(r.prior_reference_fit || {}).includes('wrong') ? 'reference cut judged wrong'
    : usedBooks.has(r.book_id) ? 'book used by #5919'
    : null;
  if (why) { drop[why] = (drop[why] || 0) + 1; continue; }
  const book = await books.findOne({ id: r.book_id }, { projection: { id: 1, language: 1, image_source: 1 } });
  if (!book) { drop['book not found'] = (drop['book not found'] || 0) + 1; continue; }
  if (getTranslateModelForBook(book) !== MODEL_LITE) { drop['routes to Flash'] = (drop['routes to Flash'] || 0) + 1; continue; }
  kept.push({ ...r, model_routed: MODEL_LITE, book_language: book.language });
}
await c.close();
kept.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page_number - b.page_number));
const rng = makeRng(5942);
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const main = []; const seen = new Set(); const short = {};
for (const [lang, q] of Object.entries(QUOTA)) {
  const picks = shuffle(kept.filter((r) => r.lang === lang)).filter((r) => !seen.has(r.book_id) && seen.add(r.book_id)).slice(0, q);
  if (picks.length < q) short[lang] = q - picks.length;
  main.push(...picks);
}
// A short stratum is topped up from Latin, the largest Lite language in production.
const need = 40 - main.length;
if (need > 0) main.push(...shuffle(kept.filter((r) => r.lang === 'Latin' && !seen.has(r.book_id))).slice(0, need));
if (main.length !== 40) throw new Error(`only ${main.length} pages`);
writeJsonl(OUT, main.map((r) => ({ ...r, set: 'main' })));
const by = {}; for (const r of main) by[r.lang] = (by[r.lang] || 0) + 1;
console.log(`pool ${pool.length}; dropped ${JSON.stringify(drop)}; eligible ${kept.length}; drawn ${main.length} ${JSON.stringify(by)}; short ${JSON.stringify(short)} -> ${OUT}`);
