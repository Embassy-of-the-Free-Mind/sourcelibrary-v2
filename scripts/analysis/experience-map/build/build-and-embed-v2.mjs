#!/usr/bin/env node
/**
 * Turn classified passages into map points.
 *
 *  1. Keep only experiential passages with a VERIFIED verbatim quote.
 *  2. Enrich with slug + work_id from Mongo (citation URL, work-level dedup).
 *  3. Deduplicate: identical quotes, and near-identical quotes within a work
 *     (scripture repeats across editions and languages — Ezekiel's wheels came
 *     back from both an alchemical anthology and an Igbo Bible).
 *  4. Embed THE QUOTE ITSELF, not the page. This is the step that makes the map
 *     a map of experience rather than of books: page vectors are dominated by
 *     genre and author, which is why an argument about the unity of the animal
 *     kind scored 0.77 against an ego-dissolution probe.
 *
 * Cost: embedding is BILLED ($0.20/1M input tokens, ~4.29 chars/token —
 * see .claude/docs/embeddings.md). Negligible at this scale, but not free:
 * every GEMINI_API_KEY* in the env is a paid key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/dereklomas/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');

const HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad';
const MODEL = 'gemini-embedding-2-preview';
const DIMS = 768;
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const words = (s) => new Set(norm(s).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

const rows = readFileSync(`${HERE}/classified-v3.jsonl`, 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`classified rows: ${rows.length}`);

let pts = rows.filter((r) => r.experiential && r.quote_verified && r.quote && r.register !== 'junk');
console.log(`experiential w/ verified quote: ${pts.length}`);

// enrich from Mongo
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const ids = [...new Set(pts.map((p) => p.book_id))];
const books = await db.collection('books')
  .find({ id: { $in: ids } }, { projection: { id: 1, slug: 1, work_id: 1, visible: 1, hidden: 1 } })
  .toArray();
await mc.close();
const bmap = new Map(books.map((b) => [b.id, b]));
console.log(`resolved ${bmap.size}/${ids.length} books`);

// a point we cannot cite is not usable, and hidden books must not be surfaced
pts = pts.filter((p) => {
  const b = bmap.get(p.book_id);
  if (!b || !b.slug) return false;
  if (b.visible !== true || b.hidden === true) return false;
  p.slug = b.slug;
  p.work_id = b.work_id || null;
  p.url = `https://sourcelibrary.org/book/${b.slug}/page/${p.page_id}`;
  return true;
});
console.log(`citable + publicly visible: ${pts.length}`);

// dedup: exact quote, then near-duplicate within a work
const byQuote = new Map();
for (const p of pts) {
  const k = norm(p.quote);
  if (!byQuote.has(k)) byQuote.set(k, p);
}
let deduped = [...byQuote.values()];
console.log(`after exact-quote dedup: ${deduped.length}`);

const byWork = new Map();
for (const p of deduped) {
  const k = p.work_id || `book:${p.book_id}`;
  if (!byWork.has(k)) byWork.set(k, []);
  byWork.get(k).push(p);
}
const kept = [];
let nearDropped = 0;
for (const [, group] of byWork) {
  const acc = [];
  for (const p of group) {
    const w = words(p.quote);
    if (acc.some((q) => jaccard(w, q._w) > 0.6)) { nearDropped++; continue; }
    p._w = w;
    acc.push(p);
  }
  kept.push(...acc);
}
console.log(`after near-duplicate dedup within work: ${kept.length} (dropped ${nearDropped})`);
kept.forEach((p) => delete p._w);

// embed the quotes
async function embedBatch(texts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: texts.map((t) => ({
              model: `models/${MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: DIMS,
            })),
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (res.ok) return (await res.json())?.embeddings?.map((e) => e.values) || null;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
  }
  return null;
}

const B = 50;
const final = [];
for (let i = 0; i < kept.length; i += B) {
  const chunk = kept.slice(i, i + B);
  const vecs = await embedBatch(chunk.map((p) => p.quote));
  if (!vecs) { console.error(`  batch ${i} failed, skipping`); continue; }
  chunk.forEach((p, j) => { if (vecs[j]) { p.vec = vecs[j]; final.push(p); } });
  if ((i / B) % 10 === 0) console.log(`  embedded ${final.length}/${kept.length}`);
  await new Promise((r) => setTimeout(r, 120));
}

writeFileSync(`${HERE}/points-v2.jsonl`, final.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(`\nwrote ${final.length} points with quote embeddings -> points.jsonl`);
