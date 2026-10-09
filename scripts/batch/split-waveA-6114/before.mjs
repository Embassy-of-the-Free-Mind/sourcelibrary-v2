#!/usr/bin/env node
// PRIOR ART: none — job-local snapshot for the #6114 wave A by-eye review (4 seeded spreads per book: image, OCR, English).
// Usage: node --env-file=… before.mjs <book_id> <bookdir>   (reads <bookdir>/positions.final.json; read-only on Mongo)
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { pageImageUrl } from '../../eval/spot-check/lib.mjs';
const [id, D] = process.argv.slice(2);
const pos = JSON.parse(fs.readFileSync(`${D}/positions.final.json`, 'utf8'));
const c = await MongoClient.connect(process.env.MONGODB_URI);
const pages = await c.db('bookstore').collection('pages').find({ book_id: id, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } }).sort({ page_number: 1 }).toArray();
await c.close();
if (pages.some((p) => p.split_from_spread)) throw new Error('already split — refusing to snapshot leaves as the BEFORE');
const pool = pages.filter((p) => pos[p.page_number] != null && (p.ocr?.data?.length || 0) > 300 && (p.translation?.data?.length || 0) > 100);
let seed = parseInt(id.slice(-8), 16); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = []; const idx = pool.map((_, i) => i);
while (pick.length < 4 && idx.length) pick.push(pool[idx.splice(Math.floor(rnd() * idx.length), 1)[0]]);
pick.sort((a, b) => a.page_number - b.page_number);
fs.mkdirSync(`${D}/before`, { recursive: true });
const out = [];
for (const p of pick) {
  const url = pageImageUrl(p);
  const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`);
  fs.writeFileSync(`${D}/before/spread-${p.page_number}.jpg`, Buffer.from(await r.arrayBuffer()));
  out.push({ page_number: p.page_number, page_id: String(p.id || p._id), fold_pct: pos[p.page_number], image_url: url, archived_photo: p.archived_photo || null, photo: p.photo,
    ocr: { data: p.ocr.data, model: p.ocr.model, source: p.ocr.source, updated_at: p.ocr.updated_at }, translation: { data: p.translation.data, model: p.translation.model, updated_at: p.translation.updated_at } });
}
fs.writeFileSync(`${D}/before.json`, JSON.stringify({ book_id: id, seed: id.slice(-8), pool: pool.length, spreads: out }, null, 1));
console.log(id, 'before:', out.map((o) => `p${o.page_number}(${o.ocr.model},${o.ocr.data.length}ch)`).join(' '));
