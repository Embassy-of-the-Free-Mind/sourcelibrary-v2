#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-error-to-translation-7611/fetch.mjs (read-only page pull for the same pages) and
// scripts/batch/cli-ocr.mjs servedImage/getPageSource (the image the OCR lanes send). This adds the image bytes and
// the neighbour pages the translate prompt needs, and writes nothing to production (#8358).
//   node --env-file=.env.production.local fetch.mjs <page-ids.json> <out pages.json> <image dir>
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
const [IDS, OUT, IMG] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'));
fs.mkdirSync(IMG, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const PROJ = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, translation_withheld: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1 };
const out = {};
for (const id of ids) {
  const p = await db.collection('pages').findOne({ id }, { projection: PROJ });
  if (!p) { console.log(id, 'NOT FOUND'); continue; }
  const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
  const src = getPageSource(p);
  const f = path.join(IMG, `${id}.jpg`);
  if (!fs.existsSync(f)) { const r = await fetch(src); if (!r.ok) { console.log(id, 'image', r.status); continue; } fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  const buf = fs.readFileSync(f);
  out[id] = { page_id: id, book_id: p.book_id, page_number: p.page_number, image_src: src, image_file: f, image_sha256: createHash('sha256').update(buf).digest('hex'), image_bytes: buf.length,
    stored_ocr: p.ocr?.data || '', ocr_model: p.ocr?.model || null, stored_english: p.translation?.data || '', translation_model: p.translation?.model || null,
    prev_english: prev?.translation?.data || null, prev_ocr: prev?.ocr?.data || null, next_ocr: next?.ocr?.data || null };
  console.log(id, p.page_number, buf.length);
}
fs.writeFileSync(OUT, JSON.stringify(out));
await c.close();
