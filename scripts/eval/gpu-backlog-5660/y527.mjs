// #5660 job gpu-resume-5660 — run from /root/gpu-backlog-5660/resume (paths are that working dir's).
// #5660 resume B4b: 200 previously-written yigdzin-527 pages (one per book), current Mongo text + image, for the guard. Read-only.
import fs from 'node:fs'; import sharp from 'sharp'; import { MongoClient } from 'mongodb';
const by = {};
for (const l of fs.readFileSync('/root/yig527/decisions.jsonl', 'utf8').trim().split('\n')) { const r = JSON.parse(l); if (r.class === 'serve') (by[r.book] ??= []).push(r); }
let seed = 4523; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const books = Object.keys(by).sort().map(b => [rnd(), b]).sort((a, b) => a[0] - b[0]).map(x => x[1]).slice(0, 200);
const pick = books.map(b => by[b][Math.floor(rnd() * by[b].length)]);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const meta = [];
for (const p of pick) {
  const pg = await db.collection('pages').findOne({ id: p.id }, { projection: { 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.engine': 1, archived_photo: 1, photo: 1 } });
  if (!pg) { meta.push({ stem: p.stem, missing: true }); continue; }
  fs.writeFileSync(`y527/txt/${p.stem}.txt`, String(pg.ocr?.data || ''));
  const url = pg.archived_photo || pg.photo; meta.push({ stem: p.stem, model: pg.ocr?.model, source: pg.ocr?.source, url });
}
fs.writeFileSync('y527/meta.jsonl', meta.map(m => JSON.stringify(m)).join('\n') + '\n');
await c.close();
const q = meta.filter(m => m.url); await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const m = q.shift(); try { const r = await fetch(m.url.startsWith('http') ? m.url : `https://images.sourcelibrary.org/${m.url}`); await sharp(Buffer.from(await r.arrayBuffer()), { failOn: 'none' }).resize(1200, 1200, { fit: 'inside' }).jpeg({ quality: 85 }).toFile(`y527/img/${m.stem}.jpg`); } catch (e) { console.log('img fail', m.stem); } } }));
const cm = {}; for (const m of meta) cm[m.model || m.source || 'none'] = (cm[m.model || m.source || 'none'] || 0) + 1; console.log(meta.length, cm);
