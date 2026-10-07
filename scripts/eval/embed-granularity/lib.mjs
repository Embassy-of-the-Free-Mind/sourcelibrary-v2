/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gemini-arm.mjs — the same embedding
 * request (model, plain text, 768 dims, no taskType: what
 * src/lib/semantic-search.ts and scripts/lib/page-embedding-text.mjs send) but
 * inline in one script and written as JSONL; four arms here share it and hold
 * ~50K vectors, so it is a module with a Float32 store. scripts/eval/lib/
 * embedding-eval.mjs — same model, no retry, no usage row.
 *
 * Shared pieces for the #6173 pilot: pool loader, the embedding call, a flat
 * Float32 vector store, cosine top-k.
 */
import fs from 'node:fs';
import path from 'node:path';
import { newEmbedUsage, addEmbedUsage, logEmbeddingUsage } from '../../lib/embedding-usage.mjs';

export const MODEL = 'gemini-embedding-2-preview';
export const DIMS = 768;
export const ENDPOINT = 'eval/embed-granularity';

export const arg = (k, d) => { const a = process.argv.slice(2); const i = a.indexOf(k); return i === -1 ? d : a[i + 1]; };
export const flag = (k) => process.argv.slice(2).includes(k);

export function loadPool(dir) {
  return fs.readFileSync(path.join(dir, 'pool.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(texts) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: texts.map((text) => ({ model: `models/${MODEL}`, content: { parts: [{ text }] }, outputDimensionality: DIMS })) }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { embeddings } = await res.json();
      if (embeddings.length !== texts.length) throw new Error('embedding count mismatch');
      return embeddings.map((e) => e.values);
    } catch (err) {
      // The embedding quota is shared with the production embedders; wait
      // rather than push (429s clear within a minute or two).
      if (attempt >= 14) throw err;
      await sleep(Math.min(120_000, 3000 * 2 ** attempt));
    }
  }
}

/**
 * Embed `texts` (cut at 8,000 chars, as production does) into one normalised
 * Float32Array of length texts.length * DIMS. Logs one aggregated usage row.
 */
export async function embedAll(texts, { concurrency = 2, label = '', ckpt = null } = {}) {
  const out = new Float32Array(texts.length * DIMS);
  const usage = newEmbedUsage();
  // Resume: a checkpoint holds the vectors so far and the batch offsets done.
  const doneBatches = new Set();
  if (ckpt && fs.existsSync(`${ckpt}.done.json`) && fs.existsSync(`${ckpt}.f32`)) {
    const prev = loadVecs(`${ckpt}.f32`);
    if (prev.length === out.length) { out.set(prev); for (const k of JSON.parse(fs.readFileSync(`${ckpt}.done.json`, 'utf8'))) doneBatches.add(k); }
  }
  const batches = [];
  for (let k = 0; k < texts.length; k += 50) if (!doneBatches.has(k)) batches.push(k);
  let done = doneBatches.size * 50;
  let sinceSave = 0;
  const save = () => { if (!ckpt) return; saveVecs(`${ckpt}.f32`, out); fs.writeFileSync(`${ckpt}.done.json`, JSON.stringify([...doneBatches])); };
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const k = batches.shift();
      if (k === undefined) return;
      const slice = texts.slice(k, k + 50).map((t) => t.slice(0, 8000));
      const vecs = await embedBatch(slice);
      addEmbedUsage(usage, slice);
      vecs.forEach((v, j) => {
        const n = Math.hypot(...v) || 1;
        for (let d = 0; d < DIMS; d++) out[(k + j) * DIMS + d] = v[d] / n;
      });
      doneBatches.add(k);
      done += slice.length; sinceSave += slice.length;
      if (sinceSave >= 2000) { sinceSave = 0; save(); console.log(`  ${label} embedded ${done}/${texts.length}`); }
    }
  }));
  save();
  const tokens = usage.tokens;
  await logEmbeddingUsage(usage, { model: MODEL, endpoint: ENDPOINT });
  return { vecs: out, tokens };
}

export function saveVecs(file, vecs) { fs.writeFileSync(file, Buffer.from(vecs.buffer, vecs.byteOffset, vecs.byteLength)); }
export function loadVecs(file) { const b = fs.readFileSync(file); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }

/** Cosine of normalised query `q` against row `i` of `vecs`. */
export function dot(vecs, i, q) { let s = 0; const o = i * DIMS; for (let d = 0; d < DIMS; d++) s += vecs[o + d] * q[d]; return s; }

export function normalise(v) { const n = Math.hypot(...v) || 1; return Float32Array.from(v, (x) => x / n); }
