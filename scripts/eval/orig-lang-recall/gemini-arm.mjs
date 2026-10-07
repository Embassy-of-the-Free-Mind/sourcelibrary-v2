#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/embedding-eval.mjs — `embedTexts` calls the same
 * model, but with an 8,000-char document cut and no query form; the query here
 * must be embedded exactly as src/lib/semantic-search.ts fetchQueryEmbedding
 * does it (plain text, 768 dims) or the arm is not the production lane.
 *
 * gemini-arm — the CURRENT lane for the #5729 recall test, measured two ways:
 *
 *  1. In-pool: the vectors production already holds in `page_translations` for
 *     the pool's pages. An untranslated page is embedded from its OCR
 *     (pageEmbeddingInput falls back), so these are Gemini-on-original vectors
 *     — the lane is NOT empty for untranslated books, only for the ones the
 *     embedder has not reached. Read, never written.
 *  2. Global: `match_semantic` over the whole store, top 10, as search and the
 *     Librarian call it — does the gold page come back at all?
 *
 * Cost: 40 query embeddings (a few hundred tokens, < $0.001). No page is embedded.
 *
 *   node --env-file=.env.production.local scripts/eval/orig-lang-recall/gemini-arm.mjs --dir /root/claude-jobs/librarian-orig-5867
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const args = process.argv.slice(2);
const DIR = args[args.indexOf('--dir') + 1];
if (!DIR || !args.includes('--dir')) { console.error('--dir required'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const pool = fs.readFileSync(path.join(DIR, 'pool.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

async function queryEmbedding(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ model: 'models/gemini-embedding-2-preview', content: { parts: [{ text }] }, outputDimensionality: 768 }] }),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings[0].values;
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET statement_timeout = 600000');

// 1. Stored vectors for the pool's pages.
const index = new Map(pool.map((r, i) => [`${r.book_id}:${r.page_number}`, i]));
const bookIds = [...new Set(pool.map((r) => r.book_id))];
const { rows } = await client.query(
  'SELECT book_id, page_number, embedding::text AS e FROM page_translations WHERE book_id = ANY($1)',
  [bookIds],
);
const vecs = [];
for (const r of rows) {
  const i = index.get(`${r.book_id}:${r.page_number}`);
  if (i === undefined) continue;
  const v = JSON.parse(r.e);
  const n = Math.hypot(...v) || 1;
  vecs.push({ i, v: v.map((x) => x / n) });
}
fs.writeFileSync(path.join(DIR, 'vec-gemini.jsonl'), vecs.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`stored Gemini vectors: ${vecs.length} / ${pool.length} pool pages`);

// 2. Query vectors + the production global RPC.
const qv = {};
const global = {};
for (const q of gold) {
  qv[q.qid] = await queryEmbedding(q.query);
  const { rows: hits } = await client.query(
    'SELECT book_id, page_number, similarity FROM match_semantic($1::vector, 0.3, 10, NULL, NULL, NULL, NULL, NULL, NULL)',
    [JSON.stringify(qv[q.qid])],
  );
  global[q.qid] = hits.map((h) => ({ book_id: h.book_id, page_number: h.page_number, sim: Number(h.similarity) }));
}
fs.writeFileSync(path.join(DIR, 'q-gemini.json'), JSON.stringify(qv));
fs.writeFileSync(path.join(DIR, 'global-gemini.json'), JSON.stringify(global, null, 1));
console.log(`queries embedded: ${Object.keys(qv).length}; global top-10 stored`);
await client.end();
