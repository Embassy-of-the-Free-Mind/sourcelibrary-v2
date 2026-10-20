#!/usr/bin/env node
/**
 * v5: turn classified passages into map points — build-and-embed-v2 re-plumbed for the two-lane v5 run.
 * PRIOR ART: build/build-and-embed-v2.mjs — same four steps (gate on experiential + VERIFIED quote, enrich slug /
 * work_id / visibility from Mongo, dedup exact + near-duplicate within a work, embed THE QUOTE not the page); it
 * hardcodes a dead scratchpad path and a laptop-only package.json, so it cannot run on Hetzner, where Gemini is
 * reachable (the laptop's egress is geo-blocked). Differences, each a fix not a change of instrument:
 *  - paths from $SL_REPO / $V5_OUT; input classified-v5.jsonl; output points-v5.jsonl;
 *  - resumable: rows already in points-v5.jsonl (by page_id) are not re-embedded;
 *  - carries lanes[] / probe_lang / probe_source / probe_dim through, so the map can ask "which lane found it";
 *  - the July `book_language` was the edition language and stays so (CLAUDE.md: language = edition).
 * PAID: gemini-embedding-2-preview, $0.20 per 1M input tokens — cents at this scale, but every key is billed.
 *   set -a; source /root/sourcelibrary/.env.production.local; set +a
 *   SL_REPO=/root/sourcelibrary V5_OUT=/root/experience-v5 node build-v5.mjs
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SL = process.env.SL_REPO || path.join(process.env.HOME, 'sourcelibrary');
const require = createRequire(path.join(SL, 'package.json'));
const { MongoClient } = require('mongodb');

const V5 = process.env.V5_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'v5');
const IN = process.env.BUILD_IN || path.join(V5, 'classified-v5.jsonl');
const OUT = process.env.BUILD_OUT || path.join(V5, 'points-v5.jsonl');
const MODEL = 'gemini-embedding-2-preview';
const DIMS = 768;
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!KEY) { console.error('no GEMINI_API_KEY in env'); process.exit(2); }

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const words = (s) => new Set(norm(s).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

const rows = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`classified rows: ${rows.length}`);

let pts = rows.filter((r) => r.experiential && r.quote_verified && r.quote && r.register !== 'junk');
console.log(`experiential w/ verified quote: ${pts.length}`);

// enrich from Mongo — a point we cannot cite is not usable, and hidden books must not be surfaced
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const ids = [...new Set(pts.map((p) => p.book_id))];
const bmap = new Map();
for (let i = 0; i < ids.length; i += 2000) {
  const books = await db.collection('books')
    .find({ id: { $in: ids.slice(i, i + 2000) } }, { projection: { id: 1, slug: 1, work_id: 1, visible: 1, hidden: 1 } })
    .toArray();
  for (const b of books) bmap.set(b.id, b);
}
await mc.close();
console.log(`resolved ${bmap.size}/${ids.length} books`);

let noSlug = 0, notPublic = 0;
pts = pts.filter((p) => {
  const b = bmap.get(p.book_id);
  if (!b || !b.slug) { noSlug++; return false; }
  if (b.visible !== true || b.hidden === true) { notPublic++; return false; }
  p.slug = b.slug;
  p.work_id = b.work_id || null;
  p.url = `https://sourcelibrary.org/book/${b.slug}/page/${p.page_number}`;
  return true;
});
console.log(`citable + publicly visible: ${pts.length} (no slug ${noSlug}, hidden/invisible ${notPublic})`);

// dedup: exact quote, then near-duplicate within a work
const byQuote = new Map();
for (const p of pts) { const k = norm(p.quote); if (!byQuote.has(k)) byQuote.set(k, p); }
const deduped = [...byQuote.values()];
console.log(`after exact-quote dedup: ${deduped.length}`);
const byWork = new Map();
for (const p of deduped) { const k = p.work_id || `book:${p.book_id}`; if (!byWork.has(k)) byWork.set(k, []); byWork.get(k).push(p); }
const kept = [];
let nearDropped = 0;
for (const [, group] of byWork) {
  const acc = [];
  for (const p of group) {
    const w = words(p.quote);
    if (acc.some((q) => jaccard(w, q._w) > 0.6)) { nearDropped++; continue; }
    p._w = w; acc.push(p);
  }
  kept.push(...acc);
}
console.log(`after near-duplicate dedup within work: ${kept.length} (dropped ${nearDropped})`);
kept.forEach((p) => delete p._w);

// resume
const done = new Set();
if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n')) { if (!l.trim()) continue; try { done.add(JSON.parse(l).page_id); } catch {} }
const todo = kept.filter((p) => !done.has(p.page_id));
console.log(`${done.size} already embedded, ${todo.length} to embed`);

async function embedBatch(texts) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: texts.map((t) => ({ model: `models/${MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: DIMS })) }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) return (await res.json())?.embeddings?.map((e) => e.values) || null;
      if (attempt === 0) console.error(`  embed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    } catch (e) { if (attempt === 0) console.error(`  embed error: ${e && e.message}`); await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); }
  }
  return null;
}

const B = 50;
let written = 0, failed = 0;
for (let i = 0; i < todo.length; i += B) {
  const chunk = todo.slice(i, i + B);
  const vecs = await embedBatch(chunk.map((p) => p.quote));
  if (!vecs) { failed += chunk.length; if (failed > 500 && failed > written) { console.error('ABORTING: embedding failing persistently'); process.exit(1); } continue; }
  chunk.forEach((p, j) => { if (vecs[j]) { p.vec = vecs[j]; appendFileSync(OUT, JSON.stringify(p) + '\n'); written++; } });
  if ((i / B) % 20 === 0) console.log(`  embedded ${written}/${todo.length}`);
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`\nwrote ${written} new points (failed ${failed}) -> ${OUT}; total ${done.size + written}`);
console.log(`BUILD-DONE ${new Date().toISOString()}`);
