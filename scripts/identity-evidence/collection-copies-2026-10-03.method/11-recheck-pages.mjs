#!/usr/bin/env node
/**
 * By-eye recheck follow-up: render chosen pages of one book side by side (#5689), for when a
 * sheet's aligned pages miss (thin OCR, front-matter offset) and the reviewer needs to look
 * at specific scan positions.
 *
 * PRIOR ART: 10-recheck-sheets.mjs renders the planned pages only; this takes indices by hand.
 *
 *   node --env-file=.env.production.local scripts/identity-evidence/collection-copies-2026-10-03.method/11-recheck-pages.mjs OUT.jpg BOOK:idx,idx BOOK:idx ... [--frac 0.5] [--h 1000]
 * idx is the 0-based position in page_number order (as in the plan); negative counts from the end.
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const args = process.argv.slice(2);
const out = args.shift();
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = +args[i + 1]; args.splice(i, 2); return v; };
const frac = opt('--frac', 1), H = opt('--h', 1000);
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await client.connect();
const db = client.db('bookstore');
const cells = [];
for (const a of args) {
  const [book, list] = a.split(':');
  const ps = await db.collection('pages').find({ book_id: book, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { _id: 0, page_number: 1, display_photo: 1, archived_photo: 1, photo: 1 } }).sort({ page_number: 1 }).toArray();
  for (let idx of list.split(',').map(Number)) {
    if (idx < 0) idx = ps.length + idx;
    const p = ps[idx];
    const url = p && (p.display_photo || p.archived_photo || p.photo);
    if (!url || url.includes('/_next/image')) continue;
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const img = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ height: H }).toBuffer();
    const m = await sharp(img).metadata();
    const h = Math.round(m.height * frac);
    const lab = Buffer.from(`<svg width="${m.width}" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#eee"/><text x="5" y="22" font-family="DejaVu Sans" font-size="19">${book.slice(-6)} idx ${idx} pnum ${p.page_number}</text></svg>`);
    cells.push({ buf: await sharp({ create: { width: m.width, height: h + 30, channels: 3, background: '#fff' } })
      .composite([{ input: lab, top: 0, left: 0 }, { input: await sharp(img).extract({ left: 0, top: 0, width: m.width, height: h }).toBuffer(), top: 30, left: 0 }]).jpeg().toBuffer(), w: m.width, h: h + 30 });
  }
}
const W = cells.reduce((s, c) => s + c.w + 10, 0), HH = Math.max(...cells.map((c) => c.h));
let x = 0; const comps = cells.map((c) => { const o = { input: c.buf, top: 0, left: x }; x += c.w + 10; return o; });
await sharp({ create: { width: W, height: HH, channels: 3, background: '#fff' } }).composite(comps).jpeg({ quality: 82 }).toFile(out);
console.log(out, cells.length, 'pages');
await client.close();
