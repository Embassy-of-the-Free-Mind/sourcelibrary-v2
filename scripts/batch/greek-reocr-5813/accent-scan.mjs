#!/usr/bin/env node
// PRIOR ART: scripts/batch/greek-reocr-5813/pilot-stats.mjs measured the same thing on the 180 pilot
// pages (4 of 137 lost their diacritics); it reads pilot files only.
//
// #5813 — how often does the flash re-read DROP Greek diacritics? For every re-read page (compare.mjs
// outcome "reread") with at least 200 Greek letters in both reads: accents and breathings per Greek
// letter, old vs new. A page counts as "dropped" when the old read had a normal density (> 0.25) and
// the new one has less than half of it. By group (A visible, D hidden, C released hold). Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/accent-scan.mjs --dir=DIR --compare=F
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIR = arg('dir');
const density = (t) => { const d = (t || '').normalize('NFD'); const g = (d.match(/[Ͱ-Ͽ]/g) || []).length; return g >= 200 ? (d.match(/[̀-ͅ]/g) || []).length / g : null; };
const meta = new Map(fs.readFileSync(`${DIR}/stage3-rows.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).map((r) => [r.page_id, r]));
const ids = new Set(fs.readFileSync(arg('compare'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outcome === 'reread').map((r) => r.page_id));
const before = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(`${DIR}/stage3-before.jsonl`) })) { const m = /"id":"([^"]+)"/.exec(l); if (m && ids.has(m[1])) before.set(m[1], density(JSON.parse(l).ocr.data)); }
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const t = {}; const dropped = []; const arr = [...ids];
for (let i = 0; i < arr.length; i += 1000) {
  for (const p of await c.db('bookstore').collection('pages').find({ id: { $in: arr.slice(i, i + 1000) }, 'ocr.model': 'gemini-3-flash-preview' }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray()) {
    const a = before.get(p.id), b = density(p.ocr.data); if (a == null || b == null) continue;
    const m = meta.get(p.id); const g = m.released_hold ? 'C' : m.visible ? 'A' : 'D';
    (t[g] ??= { greek_pages: 0, dropped: 0, books: new Set() }).greek_pages++;
    if (a > 0.25 && b < a * 0.5) { t[g].dropped++; t[g].books.add(p.book_id); dropped.push({ page_id: p.id, book_id: p.book_id, n: p.page_number, group: g, old: +a.toFixed(2), new: +b.toFixed(2) }); }
  }
}
await c.close();
fs.writeFileSync(`${DIR}/accent-dropped.json`, JSON.stringify(dropped));
for (const [g, v] of Object.entries(t)) console.log(`${g}: ${v.dropped} of ${v.greek_pages} Greek pages lost at least half their diacritics (${(100 * v.dropped / v.greek_pages).toFixed(1)} %), in ${v.books.size} books`);
const by = {}; for (const d of dropped) by[d.book_id] = (by[d.book_id] || 0) + 1;
console.log('top books', JSON.stringify(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8)));
