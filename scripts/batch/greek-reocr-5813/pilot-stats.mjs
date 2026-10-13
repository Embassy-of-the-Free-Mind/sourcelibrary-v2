#!/usr/bin/env node
// #5813 stage 2 — pilot numbers beyond agreement: per book_class, and how often the flash read drops
// Greek diacritics (accents per Greek letter, old vs new). Read-only.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
const cmp = fs.readFileSync(`${DIR}/pilot-compare.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const meta = new Map(JSON.parse(fs.readFileSync(`${DIR}/pilot-rows.json`)).map((r) => [r.page_id, r]));
const before = new Map(fs.readFileSync(`${DIR}/pilot-before.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).map((r) => [r.id, r]));
const density = (t) => { const d = (t || '').normalize('NFD'); const g = (d.match(/[Ͱ-Ͽ]/g) || []).length; return g >= 200 ? (d.match(/[̀-ͅ]/g) || []).length / g : null; };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const P = c.db('bookstore').collection('pages');
const by = {}; let dropped = [], n = 0;
const out = {};
for (const r of cmp) {
  const cls = meta.get(r.page_id)?.cls ?? 'unknown';
  (out[cls] ??= {})[r.outcome] = (out[cls][r.outcome] || 0) + 1;
  if (r.outcome !== 'reread') continue;
  (by[cls] ??= []).push(r.agreement);
  const p = await P.findOne({ id: r.page_id }, { projection: { 'ocr.data': 1, 'ocr.input_tokens': 1, 'ocr.output_tokens': 1 } });
  const a = density(before.get(r.page_id).ocr.data), b = density(p.ocr.data);
  if (a != null && b != null) { n++; if (a > 0.25 && b < a * 0.5) dropped.push({ page_id: r.page_id, cls, old: +a.toFixed(2), new: +b.toFixed(2) }); }
}
const q = (a, p) => a.sort((x, y) => x - y)[Math.floor(p * (a.length - 1))].toFixed(3);
console.log('outcomes by class', JSON.stringify(out));
for (const [k, a] of Object.entries(by)) console.log(k, 'n', a.length, 'p25', q(a, .25), 'median', q(a, .5), 'p75', q(a, .75), '<0.95:', a.filter((x) => x < 0.95).length);
console.log(`diacritics dropped (accent density halved) on ${dropped.length} of ${n} Greek pages`, JSON.stringify(dropped.reduce((m, d) => (m[d.cls] = (m[d.cls] || 0) + 1, m), {})));
await c.close();
