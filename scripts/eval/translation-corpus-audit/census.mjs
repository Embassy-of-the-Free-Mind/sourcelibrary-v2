#!/usr/bin/env node
// PRIOR ART: draw.mjs (frame per language, but reads models only for the pages it draws, so it cannot say what the
// live corpus is made of); scripts/lib/ocr-trust-gate.mjs loadOcrProfile (pages.script_type counts for ONE book).
// This is the corpus-wide census the wave-2 draw (#5274) stratifies on: for every live translated book, its served
// pages grouped by translation model / engine / prompt version / source, OCR model, and script_type.
//
//   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/census.mjs --out $JOB_SCRATCH/census.jsonl
//
// Live = visible: true && pages_count > 0 && pages_translated > 0 (CLAUDE.md canonical filter). Paginated by book
// (batches of 100 ids on the book_id index); a 300-book probe read 68K pages in 61 s. Writes one JSON line per
// (book × group), then census-summary.json beside it (counts by model, engine, prompt version, with/without
// prompt version or hash).

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = args.out || path.join(process.env.JOB_SCRATCH || '.', 'census.jsonl');
const BATCH = Number(args.batch || 100), CONC = Number(args.concurrency || 3);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
  { projection: { _id: 0, id: 1, language: 1, published: 1, year: 1, pages_count: 1, pages_translated: 1 } },
).toArray();
console.error(`${books.length} live translated books`);
const meta = Object.fromEntries(books.map((b) => [b.id, b]));
const out = fs.createWriteStream(OUT);
const batches = [];
for (let i = 0; i < books.length; i += BATCH) batches.push(books.slice(i, i + BATCH).map((b) => b.id));
let done = 0, pagesSeen = 0;
async function run(ids) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids }, 'translation.data': { $exists: true } } },
    { $group: { _id: { b: '$book_id', tm: '$translation.model', en: '$translation.engine.name', api: '$translation.engine.api', cs: '$translation.engine.call_site',
      pv: '$translation.prompt_version', ph: { $substrCP: [{ $ifNull: ['$translation.prompt_hash', ''] }, 0, 10] }, src: '$translation.source', om: '$ocr.model', st: '$script_type' }, n: { $sum: 1 } } },
  ], { allowDiskUse: true, maxTimeMS: 900000 }).toArray();
  for (const r of rows) {
    const b = meta[r._id.b];
    out.write(JSON.stringify({ book_id: r._id.b, language: b.language || null, published: b.published || null, year: b.year || null, pages_count: b.pages_count, pages_translated: b.pages_translated,
      model: r._id.tm ?? null, engine: r._id.en ?? null, api: r._id.api ?? null, call_site: r._id.cs ?? null, prompt_version: r._id.pv ?? null, prompt_hash: r._id.ph || null,
      source: r._id.src ?? null, ocr_model: r._id.om ?? null, script_type: r._id.st ?? null, n: r.n }) + '\n');
    pagesSeen += r.n;
  }
  done++;
  if (done % 10 === 0) console.error(`${done}/${batches.length} batches, ${pagesSeen} pages`);
}
const queue = [...batches];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const ids = queue.shift(); await run(ids).catch(async (e) => { console.error('retry', e.message); await run(ids); }); } }));
await new Promise((r) => out.end(r));

// Summary.
const rows = fs.readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sum = (key) => { const o = {}; for (const r of rows) { const k = key(r); o[k] = (o[k] || 0) + r.n; } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])); };
const summary = {
  at: new Date().toISOString(), books: books.length, pages: pagesSeen,
  by_model: sum((r) => r.model ?? '(none)'),
  by_engine: sum((r) => `${r.engine ?? '(no engine)'} / ${r.api ?? '-'}`),
  by_source: sum((r) => r.source ?? '(none)'),
  by_model_prompt: sum((r) => `${r.model ?? '(none)'} / ${r.prompt_version ?? '?'}`),
  by_ocr_model: sum((r) => r.ocr_model ?? '(none)'),
  prompt_provenance: sum((r) => (r.prompt_version ? 'version' : 'no-version') + '+' + (r.prompt_hash ? 'hash' : 'no-hash')),
};
fs.writeFileSync(OUT.replace(/\.jsonl$/, '') + '-summary.json', JSON.stringify(summary, null, 2));
console.error(`census: ${rows.length} rows, ${pagesSeen} pages → ${OUT}`);
await client.close();
