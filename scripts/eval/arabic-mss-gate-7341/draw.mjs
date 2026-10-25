#!/usr/bin/env node
// PRIOR ART: scripts/eval/mss-thinking-6544/draw-setb.mjs — draws one page per book across the handwritten class from
// Mongo; this gate needs a fixed list of 14 held books (#7341), 2 text pages per manuscript and 4 for the print edition,
// screened by eye for covers, blanks, colour bars, slips and two-leaf frames. Same seeded-shuffle idea, new frame.
/**
 * Candidate draw for the Arabic manuscript OCR gate (#7341). Seeded shuffle of each book's inner pages (the first and
 * last 5% are skipped: bindings, flyleaves, colour bars), the first K candidates downloaded from R2 (archived_photo)
 * to $JOB_SCRATCH/img/, and one contact sheet per book for the by-eye screen. The screen's picks go in draw.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/arabic-mss-gate-7341/draw.mjs [--k 6]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';

const SEED = 7341;
const PRINT = '6ade30b13326a0839b2d1c42';  // Kraus, Mukhtār rasāʾil, Cairo 1935
const ki = process.argv.indexOf('--k');
const K = ki >= 0 ? Number(process.argv[ki + 1]) : 6;
const ROOT = process.env.JOB_SCRATCH;
if (!ROOT) throw new Error('JOB_SCRATCH not set');
fs.mkdirSync(path.join(ROOT, 'img'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'sheets'), { recursive: true });

function rng(seed) {  // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': 'jabir-ocr-gate-7341' }).project({ id: 1, title: 1, pages_count: 1 }).toArray();
const out = [];
for (const b of books) {
  const id = b.id || String(b._id);
  const n = b.pages_count, skip = Math.ceil(n * 0.05);
  const pool = []; for (let p = skip + 1; p <= n - skip; p++) pool.push(p);
  const r = rng(SEED ^ hash(id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const k = id === PRINT ? K + 4 : K;
  const cands = [];
  for (const pn of pool.slice(0, k)) {
    const pg = await db.collection('pages').findOne({ book_id: id, page_number: pn }, { projection: { archived_photo: 1 } });
    const file = path.join(ROOT, 'img', `${id}_${pn}.jpg`);
    if (!fs.existsSync(file)) {
      const res = await fetch(pg.archived_photo);
      if (!res.ok) throw new Error(`${pg.archived_photo} ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const m = await sharp(file).metadata();
    cands.push({ page: pn, image: file, url: pg.archived_photo, w: m.width, h: m.height });
  }
  // contact sheet: candidates side by side, 360 px high, in draw order
  const tiles = await Promise.all(cands.map((x) => sharp(x.image).resize({ height: 360 }).toBuffer({ resolveWithObject: true })));
  const W = tiles.reduce((s, t) => s + t.info.width + 10, 0);
  let x = 0; const comp = tiles.map((t) => { const o = { input: t.data, left: x, top: 0 }; x += t.info.width + 10; return o; });
  await sharp({ create: { width: W, height: 360, channels: 3, background: '#888' } }).composite(comp).jpeg().toFile(path.join(ROOT, 'sheets', `${id}.jpg`));
  out.push({ book_id: id, title: b.title, pages_count: n, cell: id === PRINT ? 'ar-print' : 'ar-ms', candidates: cands.map(({ image, ...y }) => y) });
  console.log(id, n, cands.map((y) => `${y.page}(${y.w}x${y.h})`).join(' '));
}
fs.writeFileSync(path.join(ROOT, 'candidates.json'), JSON.stringify({ seed: SEED, k: K, rule: 'inner pages (first/last 5% skipped), seeded shuffle, first k; screened by eye', books: out }, null, 1));
await c.close();
