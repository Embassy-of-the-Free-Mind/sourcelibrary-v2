// #6740 read-surface: download each panel target's served image (getPageSource, as cli-ocr.mjs read does) and record its
// size, so the image-size factor's levels can be read against what the live lane sends (the image as served).
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/e5-fetch-L.mjs (fetches images for a fixed page list; no size record).
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/fetch-targets.mjs --work=DIR
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const WORK = path.resolve(process.argv.find((a) => a.startsWith('--work='))?.slice(7));
const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
fs.mkdirSync(path.join(WORK, 'img'), { recursive: true });
const rows = [];
for (const L of Object.values(panel.langs)) for (const t of [...L.targets, ...L.spares]) {
  const p = await db.collection('pages').findOne({ id: t.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1, ocr: 1 } });
  const src = getPageSource(p);
  const res = await fetch(src); const buf = Buffer.from(await res.arrayBuffer());
  const m = await sharp(buf).metadata();
  fs.writeFileSync(path.join(WORK, 'img', `${t.slug}.jpg`), buf);
  rows.push({ slug: t.slug, spare: t.spare, src, status: res.status, bytes: buf.length, w: m.width, h: m.height, long_edge: Math.max(m.width, m.height), sha256: createHash('sha256').update(buf).digest('hex'), has_ocr: !!p.ocr?.data, ocr_model: p.ocr?.model ?? null });
}
fs.writeFileSync(path.join(WORK, 'images.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const le = rows.map((r) => r.long_edge).sort((a, b) => a - b);
console.log(`${rows.length} images; long edge min ${le[0]} p25 ${le[le.length >> 2]} median ${le[le.length >> 1]} p75 ${le[(le.length * 3) >> 2]} max ${le[le.length - 1]}; non-200: ${rows.filter((r) => r.status !== 200).length}`);
await client.close();
