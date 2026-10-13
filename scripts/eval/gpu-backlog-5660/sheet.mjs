// #5660 job gpu-resume-5660 — run from /root/gpu-backlog-5660/resume (paths are that working dir's).
// contact sheet: node sheet.mjs <list.json [[bid,pn],..] or [stem,..]> <out.jpg> [cols] [cellW] [cellH] [srcDir for stems]
import fs from 'node:fs';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
const [, , listF, outF, cols = 4, cw = 420, ch = 560, srcDir] = process.argv;
const list = JSON.parse(fs.readFileSync(listF, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); let db;
async function img(item) {
  if (typeof item === 'string') return fs.readFileSync(`${srcDir}/${item}.jpg`);
  const [bid, pn] = item; const f = `cache/${bid}-p${pn}.jpg`;
  if (fs.existsSync(f)) return fs.readFileSync(f);
  if (!db) { await c.connect(); db = c.db('bookstore'); }
  const p = await db.collection('pages').findOne({ book_id: bid, page_number: pn }, { projection: { archived_photo: 1, display_photo: 1, photo: 1 } });
  const url = p?.archived_photo || p?.display_photo || p?.photo; const r = await fetch(url.startsWith('http') ? url : `https://images.sourcelibrary.org/${url}`);
  const b = await sharp(Buffer.from(await r.arrayBuffer()), { failOn: 'none' }).resize(1400, 1400, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  fs.mkdirSync('cache', { recursive: true }); fs.writeFileSync(f, b); return b;
}
const W = +cw, H = +ch, C = +cols, R = Math.ceil(list.length / C);
const comps = [];
await Promise.all(list.map(async (it, i) => {
  const b = await sharp(await img(it)).resize(W - 8, H - 30, { fit: 'contain', background: '#888' }).toBuffer();
  const x = (i % C) * W, y = Math.floor(i / C) * H;
  comps.push({ input: b, left: x + 4, top: y + 26 });
  comps.push({ input: Buffer.from(`<svg width="${W}" height="26"><rect width="${W}" height="26" fill="#000"/><text x="6" y="19" font-size="18" fill="#ff0" font-family="sans-serif">#${i}</text></svg>`), left: x, top: y });
}));
await sharp({ create: { width: C * W, height: R * H, channels: 3, background: '#444' } }).composite(comps).jpeg({ quality: 80 }).toFile(outF);
await c.close(); process.exit(0);
