#!/usr/bin/env node
// draw.mjs — the FRESH confirmation draw for guarded Paddle on Chinese held table + mixed pages (#6871 row 3). Read-only.
//
// PRIOR ART: scripts/eval/zh-residue-refs-6871/draw.mjs (the first draw: same body window, same one-page-per-book rule,
// same alternates; copied). This draws only table + mixed, 25 + 5 spares each, from books NOT in the first draw
// (every row of zh-residue-refs-6871/draw.json, spares included), and leaves out 清文鑑 titles (no credible
// reference, README §4 there).
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-confirm-6871/draw.mjs > draw.json
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const C = JSON.parse(readFileSync(here + '../zh-residue-refs-6871/classes.json', 'utf8'));
const first = JSON.parse(readFileSync(here + '../zh-residue-refs-6871/draw.json', 'utf8'));
const used = new Set(first.draws.map((d) => d.book_id));
const SEED = 68712;
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const P = { id: 1, book_id: 1, page_number: 1, photo: 1, image_width: 1, image_height: 1 };
const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1 } }).toArray();
const revPids = new Set(rev.map((r) => String(r.page_id)));
const classBids = { table: [...C.table.bids], mixed: C.mixed.bids.filter((b) => !C.seal.bids.includes(b)) };
const unread = async (bid) => (await pages.find({ book_id: bid, 'ocr.data': { $exists: false } }, { projection: P }).sort({ page_number: 1 }).toArray())
  .filter((p) => !revPids.has(String(p.id)));
const body = (ps, n) => { const w = ps.filter((p) => p.page_number >= Math.ceil(0.10 * n) && p.page_number <= Math.floor(0.95 * n)); return w.length ? [w, true] : [ps, false]; };

const out = { seed: SEED, at: new Date().toISOString(), excluded_first_draw_books: used.size, pool: {}, draws: [] };
for (const cls of ['table', 'mixed']) {
  const pool = [];
  for (const bid of classBids[cls].filter((b) => !used.has(b)).sort()) {
    const b = await books.findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, pages_count: 1, 'pipeline_auto.hold.reason': 1 } });
    if (!b || /清文鑑/.test(b.title) || b.pipeline_auto?.hold?.reason !== 'gpu-backlog-5660') continue;
    pool.push(b);
  }
  out.pool[cls] = pool.length;
  let got = 0;
  for (const b of shuffle(pool)) {
    if (got >= 30) break;
    const bid = String(b.id ?? b._id);
    const ps = await unread(bid);
    if (!ps.length) continue;
    const [win, inWindow] = body(ps, b.pages_count ?? ps.at(-1).page_number);
    const [p, ...alts] = shuffle(win);
    out.draws.push({ class: cls, book_id: bid, title: b.title, pages_count: b.pages_count, page_id: String(p.id), page: p.page_number, photo: p.photo,
      image_w: p.image_width ?? null, image_h: p.image_height ?? null, body_window: inWindow,
      alternates: alts.slice(0, 2).map((a) => ({ page_id: String(a.id), page: a.page_number, photo: a.photo })), spare: got >= 25 });
    got++;
  }
}
console.log(JSON.stringify(out, null, 1));
await c.close();
