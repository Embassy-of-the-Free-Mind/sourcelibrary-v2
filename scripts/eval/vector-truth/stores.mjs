#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-vector-truth.mjs (#6175) — the same truth check for
 * page_translations, the store this measurement is a sibling sweep of; scripts/audit/clip-index-integrity.mjs
 * covers clip_embeddings' pointers (#5195), and #4185 its dead sources — not redone here.
 *
 * stores — sampled vector truth for the other Gemini stores (#6175 step 4). One-off measurement.
 *
 * Per store, a TABLESAMPLE of rows: shape (dims / NaN / zero / norm), the e5 signature (768-dim
 * stores), duplicate vectors within the sample over different text, the row's book still existing,
 * and the cosine between the stored vector and a fresh embed of the text its writer composes:
 *   book_embeddings          stored summary_text (what enrich Phase 6.5 embedded)
 *   artwork_embeddings       stored summary_text, 3072 dims (backfill-artwork-embeddings)
 *   gallery_text_embeddings  composeEmbedText(gallery_images row) as the backfill composes it TODAY
 *   site_pages               `${title}\n\n${text}` (embed-site-pages)
 *   page_texts (es)          text.slice(0, 8000), plus mongo_updated_at vs the Mongo translation
 *
 *   node --env-file=.env.production.local scripts/eval/vector-truth/stores.mjs --n 300 --out /tmp/stores.json
 */
import { MongoClient } from 'mongodb';
import pg from 'pg';
import fs from 'node:fs';
import { EMBED_MODEL } from '../../lib/page-embedding-text.mjs';
import { newEmbedUsage, addEmbedUsage, logEmbeddingUsage } from '../../lib/embedding-usage.mjs';
import { parseVector, cosine, vectorShapeProblems, cosineClass, e5Signature } from '../../lib/vector-truth.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const N = Number(flag('--n', 300));
const OUT = flag('--out', null);
const ONLY = flag('--store', null);
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db('bookstore');
const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await sql.connect();
await sql.query("SET statement_timeout = '300s'");
const usage = newEmbedUsage();

async function embed(texts, dims) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: batch.map(t => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] }, outputDimensionality: dims })) }),
      });
      if (r.status === 429 && attempt < 5) { await new Promise(s => setTimeout(s, 10000 * (attempt + 1))); continue; }
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
      out.push(...(await r.json()).embeddings.map(e => e.values));
      addEmbedUsage(usage, batch);
      break;
    }
  }
  return out;
}

function galleryText(img) { // scripts/migration/backfill-gallery-text-embeddings.mjs composeEmbedText, verbatim
  const parts = [];
  if (img.description) parts.push(img.description);
  if (img.museum_description && img.museum_description !== img.description) parts.push(img.museum_description);
  if (img.type) parts.push(`Type: ${img.type}`);
  if (img.book_title) parts.push(`From: ${img.book_title}`);
  const m = img.metadata || {};
  if (m.subjects?.length) parts.push(`Subjects: ${m.subjects.join(', ')}`);
  if (m.figures?.length) parts.push(`Figures: ${m.figures.join(', ')}`);
  if (m.symbols?.length) parts.push(`Symbols: ${m.symbols.join(', ')}`);
  if (m.style) parts.push(`Style: ${m.style}`);
  if (m.technique) parts.push(`Technique: ${m.technique}`);
  if (m.iconclass?.length) parts.push(`Iconclass: ${m.iconclass.join(', ')}`);
  return parts.join('\n').slice(0, 4000);
}

const STORES = {
  book_embeddings: { dims: 768, pct: 2, sql: 'SELECT book_id, summary_text t, embedding::text e, embedding_model m FROM book_embeddings TABLESAMPLE SYSTEM ($1) WHERE embedding IS NOT NULL LIMIT $2', text: async rows => rows.map(r => r.t) },
  artwork_embeddings: { dims: 3072, pct: 5, sql: 'SELECT book_id, summary_text t, embedding::text e, embedding_model m FROM artwork_embeddings TABLESAMPLE SYSTEM ($1) WHERE embedding IS NOT NULL LIMIT $2', text: async rows => rows.map(r => r.t) },
  gallery_text_embeddings: {
    dims: 768, pct: 0.15, // BERNOULLI: row-level; SYSTEM sampled whole blocks, i.e. one book
    sql: 'SELECT id, book_id, page_id, generated_at, embedding::text e, embedding_model m, model legacy FROM gallery_text_embeddings TABLESAMPLE BERNOULLI ($1) WHERE embedding IS NOT NULL LIMIT $2',
    text: async rows => {
      // The row id is `${page_id}-${detection_index}` (the backfill's key), not the gallery _id.
      const imgs = new Map((await db.collection('gallery_images').find({ page_id: { $in: rows.map(r => r.page_id) } }).toArray()).map(g => [`${g.page_id}-${g.detection_index}`, g]));
      return rows.map(r => { const g = imgs.get(r.id); r.gone = !g; r.book_moved = g && String(g.book_id) !== String(r.book_id); r.src_updated = g?.updated_at ?? null; return g ? galleryText(g) : null; });
    },
  },
  site_pages: { dims: 768, pct: 100, sql: "SELECT id, url, title, text, embedding::text e, embedding_model m FROM site_pages TABLESAMPLE SYSTEM ($1) WHERE embedding IS NOT NULL ORDER BY random() LIMIT $2", text: async rows => rows.map(r => `${r.title}\n\n${r.text}`) },
  page_texts: {
    dims: 768, pct: 2,
    sql: "SELECT page_id, book_id, lang, text t, embedding::text e, embedding_model m, mongo_updated_at FROM page_texts TABLESAMPLE SYSTEM ($1) WHERE embedding IS NOT NULL LIMIT $2",
    text: async rows => {
      const ps = new Map((await db.collection('pages').find({ id: { $in: rows.map(r => r.page_id) } }).project({ id: 1, book_id: 1, 'translations.es.updated_at': 1, 'translation_es.updated_at': 1, 'ocr.updated_at': 1 }).toArray()).map(p => [p.id, p]));
      return rows.map(r => {
        const p = ps.get(r.page_id);
        r.gone = !p; r.book_moved = p && String(p.book_id) !== String(r.book_id);
        const ts = p?.translations?.es?.updated_at || p?.translation_es?.updated_at || p?.ocr?.updated_at;
        r.stale = !!(ts && r.mongo_updated_at && new Date(ts) > new Date(r.mongo_updated_at));
        return (r.t || '').slice(0, 8000);
      });
    },
  },
};

const report = { measured_at: new Date().toISOString(), stores: {} };
for (const [name, s] of Object.entries(STORES)) {
  if (ONLY && ONLY !== name) continue;
  console.error(`${name}: sampling…`);
  const rows = (await sql.query(s.sql, [s.pct, N])).rows;
  const texts = await s.text(rows);
  const books = new Set((await db.collection('books').find({ $or: [{ id: { $in: rows.map(r => r.book_id).filter(Boolean) } }] }, { projection: { id: 1 } }).toArray()).map(b => String(b.id)));
  const todo = [];
  rows.forEach((r, i) => {
    r.vec = parseVector(r.e); delete r.e;
    r.flags = vectorShapeProblems(r.vec, { dims: s.dims });
    if (r.book_id && !books.has(String(r.book_id))) r.flags.push('book-missing');
    if (r.gone) r.flags.push('source-missing');
    if (r.book_moved) r.flags.push('wrong-book');
    if (r.stale) r.flags.push('stale');
    if (r.m !== EMBED_MODEL) r.flags.push(`label:${r.m}`);
    if (r.legacy && r.legacy !== EMBED_MODEL) r.flags.push(`legacy-model:${r.legacy}`);
    r.target = texts[i];
    if (r.target && r.vec?.length === s.dims && !r.flags.includes('nan') && !r.flags.includes('zero')) todo.push(r);
  });
  const seen = new Map();
  for (const r of rows) { if (!r.vec) continue; const k = JSON.stringify(r.vec.slice(0, 16)); if (seen.has(k) && seen.get(k).target !== r.target) { r.flags.push('dup-vector'); } else seen.set(k, r); }
  const fresh = await embed(todo.map(r => r.target), s.dims);
  todo.forEach((r, i) => { r.cos = +cosine(r.vec, fresh[i]).toFixed(4); r.cls = cosineClass(r.cos); });
  const cls = {}, flags = {};
  for (const r of rows) { const c = r.cls || 'not-embedded'; cls[c] = (cls[c] || 0) + 1; for (const f of r.flags) flags[f.replace(/:.*/, '')] = (flags[f.replace(/:.*/, '')] || 0) + 1; }
  const cosSorted = todo.map(r => r.cos).sort((a, b) => a - b);
  const q = p => cosSorted.length ? cosSorted[Math.floor(p * (cosSorted.length - 1))] : null;
  const e5 = s.dims === 768 ? rows.filter(r => r.vec?.length === 768 && e5Signature(r.vec) > 0.4).length : 'n/a';
  report.stores[name] = { sampled: rows.length, embedded: todo.length, classes: cls, flags, e5_signature_rows: e5,
    cosine_quantiles: { p01: q(0.01), p05: q(0.05), p25: q(0.25), p50: q(0.5) },
    examples: rows.filter(r => r.cls && r.cls !== 'ok').slice(0, 8).map(r => ({ id: r.id || r.page_id || r.book_id, book: r.book_id, cos: r.cos, flags: r.flags })) };
  console.error(`${name}: ${JSON.stringify(report.stores[name].classes)} ${JSON.stringify(flags)}`);
}
await logEmbeddingUsage(usage, { model: EMBED_MODEL, endpoint: 'eval/vector-truth-stores', db });
console.log(JSON.stringify(report, null, 1));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
await sql.end(); await mongo.close();
