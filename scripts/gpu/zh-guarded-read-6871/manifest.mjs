#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-confirm-6871/scope.mjs (counts the same pages; this lists them) and
// scripts/eval/zh-confirm-6871/draw.mjs (same class lists, same "unread" and reverted-page rules, and it already
// excluded the 清文鑑 titles). scripts/workers/paddle-zh-lane.mjs `plan` lists pages for the #5600 cohort only, and it
// HOLDS books as it plans; this writes nothing.
//
// manifest.mjs: every page in scope for the guarded-Paddle read of the held Chinese table + mixed residue (#6871 row 3,
// job zh-guarded-read-6871). Read-only.
//
// Scope, as recommended by zh-confirm-6871 (PR #6910): the table and mixed class books (zh-residue-refs-6871/classes.json;
// seal books out of mixed), still held for gpu-backlog-5660, pages with no `ocr.data`, minus the pages reverted by
// revert-paddle-5660, minus three works no engine reads: 清文鑑 (every title), 欽定西域同文志, 琴譜合璧.
// The image: getPageSource(page), EXCEPT where it resolves to `archived_photo` and the page has an Archive
// `photo_original`. There the Archive leaf is read. On these books the R2 archived copy is a 1/3-scale JPEG
// (~760 x 1,050 px, against the Archive's ~2,290 x 3,140; same leaf, grey-thumbnail correlation 0.998-1.0 on 3 pages,
// 2026-10-18). The bake-off and the confirmation passed their bar on the Archive leaf, capped at 2,744 px, and that is the
// setting being applied. A cropped or split page keeps getPageSource's answer (none in scope at 2026-10-18).
//
//   node --env-file=<main checkout>/.env.production.local scripts/gpu/zh-guarded-read-6871/manifest.mjs <out dir>
// Writes <out>/manifest.tsv (bid, pn, pid, class, image URL; whole books, books in id order) and <out>/scope.json.
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { getPageSource } from '../../lib/page-image-url.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: manifest.mjs <out dir>'); process.exit(1); }
const here = new URL('.', import.meta.url).pathname;
const C = JSON.parse(fs.readFileSync(path.join(here, '../../eval/zh-residue-refs-6871/classes.json'), 'utf8'));
export const EXCLUDE = [
  { re: /清文鑑/, why: 'no credible reference for Manchu-Chinese pages (zh-residue-refs-6871)' },
  { re: /西域同文志/, why: 'neither engine reads it: Flash filter blocks, Paddle mis-orders the registers (#6910)' },
  { re: /琴譜合璧/, why: 'qin tablature: no Unicode for the glyphs, both engines invent (#6910)' },
];
const HOLD = 'gpu-backlog-5660';
const IA = /^https:\/\/archive\.org\/download\//;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1 } }).toArray();
const revPids = new Set(rev.map((r) => String(r.page_id)));
const P = { id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 };
const scope = { at: new Date().toISOString(), hold: HOLD, classes: {}, excluded_works: {}, no_image: 0, image_choice: {} };
const rows = [];
for (const [cls, bids] of [['table', C.table.bids], ['mixed', C.mixed.bids.filter((b) => !C.seal.bids.includes(b))]]) {
  const o = { books: 0, books_in_scope: 0, pages: 0, not_held: 0 };
  for (const bid of [...bids].sort()) {
    const b = await db.collection('books').findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, 'pipeline_auto.hold.reason': 1 } });
    if (!b) continue;
    o.books++;
    if (b.pipeline_auto?.hold?.reason !== HOLD) { o.not_held++; continue; }
    const ps = (await db.collection('pages').find({ book_id: bid, 'ocr.data': { $exists: false } }, { projection: P }).sort({ page_number: 1 }).toArray())
      .filter((p) => !revPids.has(String(p.id)));
    const ex = EXCLUDE.find((x) => x.re.test(b.title || ''));
    if (ex) { const k = ex.re.source; scope.excluded_works[k] ??= { books: 0, pages: 0, why: ex.why }; scope.excluded_works[k].books++; scope.excluded_works[k].pages += ps.length; continue; }
    if (!ps.length) continue;
    o.books_in_scope++;
    for (const p of ps) {
      const pick = getPageSource(p);
      const src = pick && pick === p.archived_photo && IA.test(p.photo_original || '') ? p.photo_original : pick;
      scope.image_choice[src === pick ? 'getPageSource' : 'photo_original'] = (scope.image_choice[src === pick ? 'getPageSource' : 'photo_original'] || 0) + 1;
      if (!src) { scope.no_image++; continue; }
      rows.push([bid, p.page_number, String(p.id), cls, src].join('\t'));
      o.pages++;
    }
  }
  scope.classes[cls] = o;
}
scope.pages = rows.length;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'manifest.tsv'), rows.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'scope.json'), JSON.stringify(scope, null, 1));
console.log(JSON.stringify(scope, null, 1));
await c.close();
