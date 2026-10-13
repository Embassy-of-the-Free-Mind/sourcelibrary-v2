// #5660 resume: fetch page images (+ stored OCR) for by-eye checks. args: JSON [[bid,pn],...] [outdir] [maxpx]
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const pairs = JSON.parse(fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : process.argv[2]);
const dir = process.argv[3] || 'eye'; const px = process.argv[4] || '1600';
fs.mkdirSync(dir, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
await Promise.all(pairs.map(async ([bid, pn]) => {
  const f = `${dir}/${bid}-p${pn}`;
  if (fs.existsSync(f + '.jpg')) return;
  const p = await db.collection('pages').findOne({ book_id: bid, page_number: pn }, { projection: { photo: 1, display_photo: 1, photo_original: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.model': 1 } });
  const url = p?.archived_photo || p?.display_photo || p?.photo || p?.photo_original;
  if (!url) return console.log('no image', bid, pn);
  const r = await fetch(url.startsWith('http') ? url : `https://images.sourcelibrary.org/${url}`);
  if (!r.ok) return console.log('fetch', r.status, bid, pn, url);
  fs.writeFileSync(f + '.orig', Buffer.from(await r.arrayBuffer()));
  try { execFileSync('vips', ['thumbnail', f + '.orig', f + '.jpg', px, '--height', px]); } catch (e) { console.log('vips fail', bid, pn); }
  fs.rmSync(f + '.orig');
  fs.writeFileSync(f + '.txt', `${p?.ocr?.model || ''}\n${p?.ocr?.data || ''}`);
}));
await c.close();
