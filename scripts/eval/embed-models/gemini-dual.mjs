#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs --fill-pool — the same
 * production-shaped call (gemini-embedding-2-preview, 768, plain text, 50 per
 * batchEmbedContents) over pool A; this one embeds the ORIGINAL text of pages
 * that already hold a translation vector, plus queries for gold sets B and C.
 *
 * gemini-dual — arm C of #6172. For every TRANSLATED page in pool T, embed its
 * cleaned OCR (cut at 8,000 chars, as the embedder cuts) into
 * vec-t-gemini-ocr.jsonl. Pages with no translation are not embedded: their
 * stored vector already IS the OCR vector. Queries are embedded exactly as
 * src/lib/semantic-search.ts fetchQueryEmbedding sends them (plain text).
 *
 * Written to files only, never to Supabase. Usage logged to gemini_usage as
 * endpoint `eval/embed-models`. Resumable.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-models/gemini-dual.mjs --dir /root/claude-jobs/embed-models-eval
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newEmbedUsage, addEmbedUsage, logEmbeddingUsage, usdForTokens } from '../../lib/embedding-usage.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const DIR = arg('--dir');
if (!DIR) { console.error('--dir required'); process.exit(1); }
const MODEL = 'gemini-embedding-2-preview';
const here = path.dirname(fileURLToPath(import.meta.url));

async function embedBatch(texts) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: texts.map((text) => ({ model: `models/${MODEL}`, content: { parts: [{ text }] }, outputDimensionality: 768 })) }),
      },
    );
    if (res.ok) return (await res.json()).embeddings.map((e) => { const n = Math.hypot(...e.values) || 1; return e.values.map((x) => x / n); });
    if (attempt >= 10 || (res.status !== 429 && res.status < 500)) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, Math.min(60000, 2000 * 2 ** attempt)));
  }
}

const usage = newEmbedUsage();

// Queries: gold B (librarian golden set) and gold C.
const qFile = path.join(DIR, 'q-t-gemini.json');
if (!fs.existsSync(qFile)) {
  const b = JSON.parse(fs.readFileSync(path.join(here, '../librarian-search/golden-set.json'), 'utf8')).queries.map((q) => [q.id, q.query]);
  const c = JSON.parse(fs.readFileSync(path.join(here, 'gold-c.json'), 'utf8')).queries.map((q) => [q.qid, q.query]);
  const all = [...b, ...c];
  const vecs = await embedBatch(all.map(([, t]) => t));
  addEmbedUsage(usage, all.map(([, t]) => t));
  fs.writeFileSync(qFile, JSON.stringify(Object.fromEntries(all.map(([id], i) => [id, vecs[i]]))));
  console.log(`queries embedded: ${all.length}`);
}

// Original-text vectors for translated pool-T pages — or, with --fresh, a
// re-embed of EXACTLY the text each stored vector was made from (the `trans`
// field), for every page: a control that separates "a new model" from "a
// re-embed with the same model" (stored vectors can be out of sync with their text).
const FRESH = args.includes('--fresh');
const pool = fs.readFileSync(path.join(DIR, 'pool-t.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const outFile = path.join(DIR, FRESH ? 'vec-t-gemini-fresh.jsonl' : 'vec-t-gemini-ocr.jsonl');
const field = FRESH ? 'trans' : 'ocr';
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).i) : []);
const todo = pool.map((r, i) => ((FRESH || r.translated) && !done.has(i) ? i : -1)).filter((i) => i >= 0);
console.log(`${field} vectors: ${done.size} done, ${todo.length} to embed`);
const chunks = [];
for (let k = 0; k < todo.length; k += 50) chunks.push(todo.slice(k, k + 50));
let next = 0;
let n = 0;
const t0 = Date.now();
async function worker() {
  while (next < chunks.length) {
    const idx = chunks[next++];
    const texts = idx.map((i) => pool[i][field].slice(0, 8000));
    const vecs = await embedBatch(texts);
    addEmbedUsage(usage, texts);
    fs.appendFileSync(outFile, idx.map((i, j) => JSON.stringify({ i, v: vecs[j].map((x) => +x.toFixed(6)) })).join('\n') + '\n');
    n += idx.length;
    if (n % 1000 < 50) console.log(`  ${n}/${todo.length}  ${(n / ((Date.now() - t0) / 1000)).toFixed(1)} pages/s`);
  }
}
try {
  await Promise.all(Array.from({ length: Number(arg('--concurrency', 2)) }, worker));
} finally {
  const { texts, tokens } = usage;
  await logEmbeddingUsage(usage, { model: MODEL, endpoint: 'eval/embed-models' });
  console.log(`logged: ${texts} texts, ~${tokens} tokens ≈ $${usdForTokens(tokens).toFixed(4)}`);
}
