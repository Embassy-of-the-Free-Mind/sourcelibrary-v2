#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/embedding-server.mjs — serves the same
 * multilingual-e5-base on :3456, but one text per call, a 2,000-char cut with
 * no token truncation, and it is shared with the CLIP proxy; a 8.6K-page pool
 * through it would hold that port for an hour. This loads the model in-process
 * with the same `@xenova/transformers` runtime and the same "passage: "/"query: "
 * prefixes, so its e5 vectors are the server's vectors.
 *
 * embed-local — embed the #5729 pool (and the gold queries) with an open
 * multilingual model on this box's CPU. Free; ~4 pages/s for e5-base and ~1/s
 * for bge-m3 on a loaded Hetzner box (measured 2026-10-07).
 *
 *   --model e5-base  Xenova/multilingual-e5-base, mean pooling, e5 prefixes
 *   --model bge-m3   Xenova/bge-m3 (dense head), CLS pooling, no prefix
 *
 * Both truncate at 512 tokens — e5's limit; bge-m3 takes 8K but is held to the
 * same window so the two differ by model, not by how much text they read.
 *
 * Writes <dir>/vec-<model>.jsonl (one { i, v } per pool row, resumable) and
 * <dir>/q-<model>.json (query vectors keyed by qid).
 *
 *   node scripts/eval/orig-lang-recall/embed-local.mjs --model e5-base --dir /root/claude-jobs/librarian-orig-5867
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, AutoModel, env } from '@xenova/transformers';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const MODEL = arg('--model', 'e5-base');
const DIR = arg('--dir');
const BATCH = Number(arg('--batch', 8));
if (!DIR) { console.error('--dir required'); process.exit(1); }

const SPECS = {
  'e5-base': { hf: 'Xenova/multilingual-e5-base', pooling: 'mean', passage: 'passage: ', query: 'query: ' },
  'bge-m3': { hf: 'Xenova/bge-m3', pooling: 'cls', passage: '', query: '' },
};
const spec = SPECS[MODEL];
if (!spec) { console.error(`unknown --model ${MODEL}`); process.exit(1); }
// Keep the 570 MB bge-m3 download out of the shared node_modules cache.
if (MODEL !== 'e5-base') env.cacheDir = path.join(DIR, 'models');

const tokenizer = await AutoTokenizer.from_pretrained(spec.hf);
const model = await AutoModel.from_pretrained(spec.hf, { quantized: true });

async function embed(texts) {
  const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
  const { last_hidden_state: h } = await model(inputs);
  const [n, len, dim] = h.dims;
  const mask = inputs.attention_mask.data;
  const out = [];
  for (let b = 0; b < n; b++) {
    const v = new Float32Array(dim);
    if (spec.pooling === 'cls') {
      for (let d = 0; d < dim; d++) v[d] = h.data[b * len * dim + d];
    } else {
      let count = 0;
      for (let t = 0; t < len; t++) {
        if (!Number(mask[b * len + t])) continue;
        count++;
        for (let d = 0; d < dim; d++) v[d] += h.data[(b * len + t) * dim + d];
      }
      for (let d = 0; d < dim; d++) v[d] /= count || 1;
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += v[d] * v[d];
    norm = Math.sqrt(norm) || 1;
    out.push(Array.from(v, (x) => +(x / norm).toFixed(6)));
  }
  return out;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const qv = {};
for (const q of gold) qv[q.qid] = (await embed([spec.query + q.query]))[0];
fs.writeFileSync(path.join(DIR, `q-${MODEL}.json`), JSON.stringify(qv));

const pool = fs.readFileSync(path.join(DIR, 'pool.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const vecFile = path.join(DIR, `vec-${MODEL}.jsonl`);
const done = new Set(fs.existsSync(vecFile)
  ? fs.readFileSync(vecFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).i)
  : []);
const todo = pool.map((r, i) => i).filter((i) => !done.has(i));
console.log(`${MODEL}: ${pool.length} pool pages, ${done.size} done, ${todo.length} to embed`);
const t0 = Date.now();
for (let k = 0; k < todo.length; k += BATCH) {
  const idx = todo.slice(k, k + BATCH);
  const vecs = await embed(idx.map((i) => spec.passage + pool[i].text));
  fs.appendFileSync(vecFile, idx.map((i, j) => JSON.stringify({ i, v: vecs[j] })).join('\n') + '\n');
  if ((k / BATCH) % 25 === 0) {
    const rate = (k + idx.length) / ((Date.now() - t0) / 1000);
    console.log(`  ${done.size + k + idx.length}/${pool.length}  ${rate.toFixed(2)} pages/s`);
  }
}
console.log(`Done: ${MODEL} ${pool.length} pages in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
