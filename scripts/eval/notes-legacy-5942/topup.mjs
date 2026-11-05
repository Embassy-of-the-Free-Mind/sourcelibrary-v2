#!/usr/bin/env node
// PRIOR ART: draw.mjs (this folder) draws pages uniformly; a uniform draw of 59,387 pages finds only 12 pages with any
// [[label: …]] block and 3 with a plain "Summary:" line. This one finds the rare syntaxes on purpose, for the
// >= 300-pages-per-syntax conformance sample: every translated page of given books, and/or a server-side regex over a
// `translation.updated_at` window (indexed; scanned a day at a time, matches only come back).
/**
 * #5942 legacy syntaxes — read-only, $0.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-legacy-5942/topup.mjs \
 *     [--books-file books.txt] [--from 2026-01-01 --to 2026-03-16 --regex '\[\[[A-Za-z][A-Za-z ]{0,20}:'] \
 *     --out $JOB_SCRATCH/topup.jsonl.gz [--only-legacy]
 * --only-legacy keeps only pages on which syntaxes.mjs detects a legacy syntax.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { detect } from './syntaxes.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out');
const ONLY = args.includes('--only-legacy');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = new MongoClient(process.env.MONGODB_URI, { appName: 'notes-legacy-5942-topup' });
await c.connect();
const P = c.db('bookstore').collection('pages');
const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.model': 1, 'translation.updated_at': 1 };
const out = zlib.createGzip();
out.pipe(fs.createWriteStream(OUT));
const seen = new Set();
let n = 0, kept = 0;
const take = (p) => {
  const t = p.translation;
  if (!t || typeof t.data !== 'string' || !t.data || seen.has(p.id)) return;
  seen.add(p.id);
  n++;
  if (ONLY && !detect(t.data).some((id) => !['«…»', '[…] lacuna', '"# Title Page"-style heading'].includes(id))) return;
  kept++;
  out.write(JSON.stringify({ id: p.id, book_id: p.book_id, page_number: p.page_number, page_type: p.page_type ?? null, prompt_version: t.prompt_version ?? null, model: t.model ?? null, updated_at: t.updated_at ?? null, data: t.data, w: null }) + '\n');
};
if (opt('books-file')) {
  const books = fs.readFileSync(opt('books-file'), 'utf8').split(/\s+/).filter(Boolean);
  for (const b of books) {
    for await (const p of P.find({ book_id: b, 'translation.data': { $type: 'string' } }).project(proj).batchSize(1000)) take(p);
    console.log(`book ${b}: ${n} pages read, ${kept} kept`);
    await sleep(100);
  }
}
if (opt('from')) {
  const re = new RegExp(opt('regex'));
  for (let t = new Date(opt('from')); t < new Date(opt('to')); t = new Date(t.getTime() + 864e5)) {
    const b = new Date(t.getTime() + 864e5);
    for await (const p of P.find({ 'translation.updated_at': { $gte: t, $lt: b }, 'translation.data': { $regex: re } }).project(proj).batchSize(1000)) take(p);
    console.log(`${t.toISOString().slice(0, 10)}: ${n} matched, ${kept} kept`);
    await sleep(200);
  }
}
await new Promise((res) => out.end(res));
console.log(`done: ${n} pages, ${kept} kept`);
await c.close();
