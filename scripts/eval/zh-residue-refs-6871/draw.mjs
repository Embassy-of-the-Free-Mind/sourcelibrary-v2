#!/usr/bin/env node
// draw.mjs — seeded draw of reference pages from the Chinese held residue, by class (#6871 item 3). Read-only.
//
// PRIOR ART: /root/gpu-backlog-5660/class-draw.mjs (per-type stress draw for the Paddle gate, main box, never
// committed) — it drew READ pages by type for scoring Paddle; this draws UNREAD residue pages per hold class.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-residue-refs-6871/draw.mjs > draw.json
//
// Per class: 24 books uniformly (20 + 4 spares), one page per book, uniform among the book's unread pages whose
// page_number lies in the body window [10%, 95%] of pages_count (all unread pages if the window holds none).
// Each book also gets 2 alternates from the same pool, used only when the readers find the drawn page blank
// or a non-body leaf (cover, fold strip, colour card). reverted: 11 books only, so all 8 single-page books
// plus 4 pages from each of the 3 清文鑑 volumes (20) — the one-per-book rule cannot hold there.
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const C = JSON.parse(readFileSync(here + 'classes.json', 'utf8'));
const SEED = 6871;
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const P = { id: 1, book_id: 1, page_number: 1, photo: 1, image_width: 1, image_height: 1 };

const held = await books.find({ 'pipeline_auto.hold.reason': 'gpu-backlog-5660' }, { projection: { id: 1, title: 1, pages_count: 1 } }).toArray();
const meta = new Map(held.map(b => [String(b.id ?? b._id), b]));
const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1 } }).toArray();
const revPids = new Set(rev.map(r => String(r.page_id)));
const listed = new Set(['table', 'mixed', 'seal'].flatMap(k => C[k].bids));
const classBids = {
  table: [...C.table.bids], mixed: C.mixed.bids.filter(b => !C.seal.bids.includes(b)), seal: [...C.seal.bids],
  other: [...meta.keys()].filter(b => !listed.has(b)).sort(),
};

const unread = async bid => (await pages.find({ book_id: bid, 'ocr.data': { $exists: false } }, { projection: P }).sort({ page_number: 1 }).toArray())
  .filter(p => !revPids.has(String(p.id)));
const body = (ps, n) => { const w = ps.filter(p => p.page_number >= Math.ceil(0.10 * n) && p.page_number <= Math.floor(0.95 * n)); return w.length ? [w, true] : [ps, false]; };
const row = (cls, b, p, inWindow, alts) => ({ class: cls, book_id: String(b.id ?? b._id), title: b.title, pages_count: b.pages_count, page_id: String(p.id), page: p.page_number, photo: p.photo, image_w: p.image_width ?? null, image_h: p.image_height ?? null, body_window: inWindow, alternates: alts.map(a => ({ page_id: String(a.id), page: a.page_number, photo: a.photo })) });

const out = { seed: SEED, at: new Date().toISOString(), draws: [] };
for (const cls of ['table', 'mixed', 'seal', 'other']) {
  let got = 0;
  for (const bid of shuffle(classBids[cls].sort())) {
    if (got >= 24) break;
    const b = meta.get(bid) ?? await books.findOne({ id: bid }, { projection: { id: 1, title: 1, pages_count: 1 } });
    const ps = await unread(bid);
    if (!ps.length) continue;
    const [pool, inWindow] = body(ps, b.pages_count ?? ps.at(-1).page_number);
    const [p, ...alts] = shuffle(pool);
    out.draws.push({ ...row(cls, b, p, inWindow, alts.slice(0, 2)), spare: got >= 20 });
    got++;
  }
}
// reverted: by page id
const rp = await pages.find({ id: { $in: [...revPids] }, 'ocr.data': { $exists: false } }, { projection: P }).toArray();
const byBook = new Map(); for (const p of rp) (byBook.get(p.book_id) ?? byBook.set(p.book_id, []).get(p.book_id)).push(p);
for (const bid of [...byBook.keys()].sort()) {
  const b = meta.get(bid) ?? await books.findOne({ id: bid }, { projection: { id: 1, title: 1, pages_count: 1 } });
  const [pool, inWindow] = body(byBook.get(bid).sort((x, y) => x.page_number - y.page_number), b.pages_count);
  const pick = shuffle(pool);
  const k = byBook.get(bid).length > 1 ? 4 : 1;
  for (let i = 0; i < k && i < pick.length; i++) out.draws.push({ ...row('reverted', b, pick[i], inWindow, pick.slice(k + i * 2, k + i * 2 + 2)), spare: false });
}
console.log(JSON.stringify(out, null, 1));
await c.close();
