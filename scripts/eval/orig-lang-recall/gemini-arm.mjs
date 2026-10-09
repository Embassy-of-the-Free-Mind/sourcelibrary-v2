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
 *  3. `--ocr-only-rank`: the gold page's EXACT rank among every OCR-only row
 *     (empty `translation`, ~1.46M) — what a lane holding only original-language
 *     vectors would return, at its real size. One sequential scan that counts,
 *     per query, the rows closer than the gold; no sort, no index. An exact
 *     top-10 over those rows took 256 s per query, so it is not run that way.
 *
 *  3b. `--iterative-scan`: the same OCR-only lane through the EXISTING HNSW
 *     index with pgvector 0.8 `hnsw.iterative_scan = relaxed_order`
 *     (ef_search 100) — what a lane costs with no new index. Hit or miss
 *     per query plus latency, against the exact ranks from 3.
 *  4. `--fill-pool`: embed the pool pages that have NO stored vector (2,986, of
 *     which 2,904 Chinese — the embedder has barely reached Chinese) into
 *     vec-gemini-fill.jsonl, so the Gemini arm can be scored on the whole pool:
 *     what the lane would hold once the OCR-only tail is embedded. Same input
 *     as production (cleanPageText, 8,000 chars). ~675K chars ≈ $0.03, logged
 *     to gemini_usage via logEmbeddingUsage. Written to a file, never to Supabase.
 *
 * Cost without --fill-pool: 40 query embeddings (< $0.001).
 *
 *   node --env-file=.env.production.local scripts/eval/orig-lang-recall/gemini-arm.mjs --dir /root/claude-jobs/librarian-orig-5867
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newEmbedUsage, addEmbedUsage, logEmbeddingUsage, estimateUsd } from '../../lib/embedding-usage.mjs';

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

if (args.includes('--fill-pool')) {
  const have = new Set(fs.readFileSync(path.join(DIR, 'vec-gemini.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).i));
  const todo = pool.map((_, i) => i).filter((i) => !have.has(i));
  const usage = newEmbedUsage();
  const out = [];
  let chars = 0;
  for (let k = 0; k < todo.length; k += 50) {
    const idx = todo.slice(k, k + 50);
    const texts = idx.map((i) => pool[i].text.slice(0, 8000));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: texts.map((text) => ({ model: 'models/gemini-embedding-2-preview', content: { parts: [{ text }] }, outputDimensionality: 768 })) }),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const { embeddings } = await res.json();
    addEmbedUsage(usage, texts);
    chars += texts.reduce((s, t) => s + t.length, 0);
    embeddings.forEach((e, j) => { const n = Math.hypot(...e.values) || 1; out.push({ i: idx[j], v: e.values.map((x) => x / n) }); });
  }
  fs.writeFileSync(path.join(DIR, 'vec-gemini-fill.jsonl'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
  await logEmbeddingUsage(usage, { model: 'gemini-embedding-2-preview', endpoint: 'eval/orig-lang-recall-5729' });
  console.log(`filled ${out.length} pool pages, ${chars} chars ≈ $${estimateUsd(chars).toFixed(4)} (logged)`);
  process.exit(0);
}

if (args.includes('--iterative-scan')) {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const qv = JSON.parse(fs.readFileSync(path.join(DIR, 'q-gemini.json'), 'utf8'));
  const out = {};
  const times = [];
  for (const q of gold) {
    await client.query('BEGIN');
    await client.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
    await client.query('SET LOCAL hnsw.ef_search = 100');
    await client.query('SET LOCAL statement_timeout = 60000');
    const t = Date.now();
    const { rows } = await client.query(
      `SELECT book_id, page_number FROM page_translations
       WHERE embedding IS NOT NULL AND coalesce(translation, '') = ''
       ORDER BY embedding <=> $1::vector LIMIT 10`,
      [JSON.stringify(qv[q.qid])],
    );
    times.push(Date.now() - t);
    await client.query('COMMIT');
    out[q.qid] = { hit: rows.some((r) => r.book_id === q.book_id && r.page_number === q.page_number), n: rows.length };
  }
  fs.writeFileSync(path.join(DIR, 'iterative-scan-gemini.json'), JSON.stringify({ out, times }, null, 1));
  times.sort((a, b) => a - b);
  console.log(`iterative scan: median ${times[Math.floor(times.length / 2)]} ms, p90 ${times[Math.floor(times.length * 0.9)]} ms`);
  await client.end();
  process.exit(0);
}

if (args.includes('--ocr-only-rank')) {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 3600000');
  const qv = JSON.parse(fs.readFileSync(path.join(DIR, 'q-gemini.json'), 'utf8'));
  await client.query('CREATE TEMP TABLE q (qid text, v vector(768), gd float8)');
  for (const q of gold) {
    const { rows: g } = await client.query(
      `SELECT embedding <=> $1::vector AS d FROM page_translations WHERE book_id = $2 AND page_number = $3 AND coalesce(translation, '') = ''`,
      [JSON.stringify(qv[q.qid]), q.book_id, q.page_number],
    );
    if (g.length) await client.query('INSERT INTO q VALUES ($1, $2::vector, $3)', [q.qid, JSON.stringify(qv[q.qid]), g[0].d]);
  }
  const t0 = Date.now();
  const { rows } = await client.query(`
    SELECT q.qid, count(*) FILTER (WHERE (p.embedding <=> q.v) < q.gd)::int AS closer
    FROM page_translations p CROSS JOIN q
    WHERE coalesce(p.translation, '') = ''
    GROUP BY q.qid`);
  const rank = Object.fromEntries(rows.map((r) => [r.qid, r.closer + 1]));
  fs.writeFileSync(path.join(DIR, 'ocr-only-rank-gemini.json'), JSON.stringify(rank, null, 1));
  console.log(`ocr-only exact ranks for ${rows.length} queries in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await client.end();
  process.exit(0);
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
