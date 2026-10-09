#!/usr/bin/env node
// #6012 step 3 input: the STC / Wing / ESTC number of each Internet Archive "bim_" microfilm book we hold
// (IA metadata field `collection-catalog-number`). This is the catalogue join #5488 used for EEBO-TCP;
// its list (job-local, 868 Latin books) was never committed. 1 request/second, identified client.
// PRIOR ART: /data/scratch latin-5126/bim-meta.jsonl + join-tcp.js (job-local). Reused as a cache when present.
//   node scripts/eval/typed-refs-6012/ia-catalog-numbers.mjs --work=/data/scratch/sl/typed-refs-6012
import fs from 'node:fs';
import { argOf, UA } from './lib.mjs';
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const out = `${WORK}/ia-catalog-numbers.jsonl`;
const done = new Map();
if (fs.existsSync(out)) for (const l of fs.readFileSync(out, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); done.set(r.ia, r); }
const prior = '/data/scratch/sl/latin-5126/bim-meta.jsonl';
if (fs.existsSync(prior)) for (const l of fs.readFileSync(prior, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.cat && !done.has(r.ia)) { done.set(r.ia, { ia: r.ia, cat: String(r.cat), from: 'latin-5126 cache' }); fs.appendFileSync(out, JSON.stringify(done.get(r.ia)) + '\n'); } }
const books = fs.readFileSync(`${WORK}/books.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ids = [...new Set(books.map((b) => b.ia_identifier || b.image_source?.identifier).filter((x) => /^bim_/.test(String(x || ''))))].filter((x) => !done.has(x));
console.log('to fetch', ids.length, 'cached', done.size);
for (const ia of ids) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://archive.org/metadata/${ia}/metadata`, { headers: { 'user-agent': UA } });
    const m = (await r.json()).result || {};
    fs.appendFileSync(out, JSON.stringify({ ia, cat: m['collection-catalog-number'] ?? null, ia_title: m.title ?? null, ia_date: m.date ?? null, ia_lang: m.language ?? null, from: 'archive.org metadata' }) + '\n');
  } catch (e) { console.log('fail', ia, e.message); }
  await new Promise((res) => setTimeout(res, Math.max(0, 1000 - (Date.now() - t0))));
}
console.log('done');
