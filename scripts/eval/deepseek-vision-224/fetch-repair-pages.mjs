#!/usr/bin/env node
// PRIOR ART: scripts/eval/error-zoo/repair-pilot/snapshot.mjs (reads the stored OCR text of manifest pages, read-only; no images) and
// scripts/batch/ocr-convergence/driver.mjs audit-packets (needs a decisions dir this test does not have). This lays out the 151 kept rows of
// repair-queue-2026-11-12.json as a runner bench (images <=2400 px, same rule as the wave benches) plus their stored text. Read-only. #224.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/deepseek-vision-224/fetch-repair-pages.mjs
import fs from 'node:fs'; import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { fetchImage } from '../lib/runners.mjs';
const J = process.env.JOB_SCRATCH; const B = `${J}/repair`; const D = `${B}/bench/repair-queue`;
fs.mkdirSync(`${D}`, { recursive: true }); fs.mkdirSync(`${B}/stored`, { recursive: true });
const q = JSON.parse(fs.readFileSync('scripts/eval/error-zoo/repair-queue-2026-11-12.json', 'utf8')).rows;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const docs = await c.db('bookstore').collection('pages').find({ id: { $in: q.map(r => r.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, photo_original: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1 } }).toArray();
const books = await c.db('bookstore').collection('books').find({ id: { $in: [...new Set(q.map(r => r.book_id))] } }, { projection: { id: 1, year: 1, published: 1, language: 1, title: 1 } }).toArray();
await c.close();
const by = new Map(docs.map(d => [d.id, d])); const bk = new Map(books.map(b => [b.id, b]));
const meta = []; const miss = [];
for (const r of q) {
  const d = by.get(r.page_id); if (!d) { miss.push([r.page_id, 'no page']); continue; }
  const url = getPageSource(d); if (!url) { miss.push([r.page_id, 'no image']); continue; }
  try {
    let buf = await fetchImage(url, 90000); const m = await sharp(buf).metadata();
    if (m.width > 2400) buf = await sharp(buf).resize({ width: 2400 }).jpeg({ quality: 92 }).toBuffer(); else if (m.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(`${D}/${r.page_id}.jpg`, buf);
    fs.writeFileSync(`${B}/stored/${r.page_id}.txt`, d.ocr?.data || '');
    const b = bk.get(r.book_id) || {};
    meta.push({ ...r, stored_chars: (d.ocr?.data || '').length, stored_model: d.ocr?.model ?? null, year: b.year ?? null, published: b.published ?? null, book_language: b.language ?? null, title: b.title ?? null });
  } catch (e) { miss.push([r.page_id, e.message.slice(0, 80)]); }
}
fs.writeFileSync(`${D}/manifest.json`, JSON.stringify({ stratum: 'repair-queue', pages: meta.map(m => ({ slug: m.page_id })) }));
fs.writeFileSync(`${B}/meta.json`, JSON.stringify(meta, null, 1));
console.log('ok', meta.length, 'missing', miss);
