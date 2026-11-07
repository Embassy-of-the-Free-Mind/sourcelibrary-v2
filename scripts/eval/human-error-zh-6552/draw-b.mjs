#!/usr/bin/env node
// PRIOR ART: draw-a2.mjs (this directory: Kanripo by <pb>, one witness per class); cbeta-ref-6101.mjs (CBETA fitted to woodblock scans, not the Taisho leaf).
// #6552 collection B: CBETA vs the Taisho leaf it keyed. Vol. 8 only (book 69b99f786ed9e0490990abcf, IA 008_20220309). One page per work, stored Paddle read.
// Edition established three ways, recorded per pick: book page - printed page is one constant (16) over every stored read; the page's Dice with its own CBETA page
// against the runner-up page; the running head's printed number, checked on the leaf by eye for a sample. READ-ONLY on Mongo. Text stays under $JOB_SCRATCH.
//   node --env-file=... draw-b.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { parseCbeta } from './cbeta.mjs';
import { hanChars, mulberry, shuffled } from './lib.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
const ROOT = path.join(process.env.JOB_SCRATCH, 'b'), X = path.join(ROOT, 'xml'), BOOK = '69b99f786ed9e0490990abcf', OFFSET = 16, DICE = 0.9, rng = mulberry(65522);
for (const d of ['pages', 'img', 'lines']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
const P = {}; const W = {};
for (const f of fs.readdirSync(X).filter((x) => x.startsWith('T08')).sort()) { const t = f.slice(4, -4).replace(/^n/, ''), d = parseCbeta(path.join(X, f)); W[t] = Object.keys(d); for (const [p, v] of Object.entries(d)) (P[p] ||= { chars: [] }).chars.push(...v.chars); }
const { rows } = JSON.parse(fs.readFileSync(path.join(ROOT, 'stored.json')));
const good = rows.filter((r) => r.pn - +r.p === OFFSET && r.d >= DICE), loose = rows.filter((r) => r.pn - +r.p === OFFSET && r.d >= 0.85);
const seen = new Set(), picks = [];
for (const t of Object.keys(W).sort((a, b) => W[a].length - W[b].length)) { // shortest works first: they have the fewest pages to give
  const cand = good.filter((r) => W[t].includes(r.p) && !seen.has(r.p)), fall = loose.filter((r) => W[t].includes(r.p) && !seen.has(r.p));
  const r = shuffled(cand.length ? cand : fall, rng)[0]; if (!r) continue;
  seen.add(r.p); picks.push({ uid: `B-T${t}`, work: `T${t}`, printed: r.p, pn: r.pn, page_id: r.id, photo: r.photo, dice: r.d, runner_up: r.sec, han: r.han, ocr_source: 'paddle' });
}
// 30 pages, 29 works with a usable page: the 30th is a second page of the longest work; the bootstrap resamples by work, so it is not a 30th cluster.
{ const t = '0221', r = shuffled(good.filter((x) => W[t].includes(x.p) && !seen.has(x.p)), rng)[0]; seen.add(r.p); picks.push({ uid: `B-T${t}x`, work: `T${t}`, printed: r.p, pn: r.pn, page_id: r.id, photo: r.photo, dice: r.d, runner_up: r.sec, han: r.han, ocr_source: 'paddle' }); }
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] }), pages = c.db('bookstore').collection('pages');
const flat = (p) => P[p]?.chars.map((x) => x.c).join('') || '';
for (const p of picks) {
  const row = await pages.findOne({ id: p.page_id }, { projection: { 'ocr.data': 1, photo: 1 } }), prev = String(+p.printed - 1).padStart(4, '0'), next = String(+p.printed + 1).padStart(4, '0');
  const tail = [...flat(prev)].slice(-60), self = P[p.printed].chars;
  fs.writeFileSync(path.join(ROOT, 'pages', `${p.uid}.json`), JSON.stringify({ typed: `${tail.join('')}\u0001${flat(p.printed)}\u0001${[...flat(next)].slice(0, 60).join('')}`, ocr: bodyText(row.ocr.data), changed_at: self.flatMap((x, i) => x.changed ? [tail.length + i] : []) }));
  const f = path.join(ROOT, 'img', `${p.uid}.jpg`);
  if (!fs.existsSync(f)) { const r = await fetch(row.photo, { redirect: 'follow' }); if (!r.ok) { console.log(p.uid, 'HTTP', r.status); continue; } fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  const m = await sharp(f).metadata(); p.w = m.width; p.h = m.height; p.typed_han = P[p.printed].chars.length; p.cbeta_changed = P[p.printed].chars.filter((x) => x.changed).length;
  console.log(p.uid, p.printed, p.pn, p.dice, p.runner_up, m.width, m.height, p.cbeta_changed);
}
await c.close();
fs.writeFileSync(new URL('./draw-b.json', import.meta.url), JSON.stringify({ book: BOOK, ia: '008_20220309', offset: OFFSET, seed: 65522, dice_min: DICE, stored_reads: rows.length, offset_constant_over: rows.filter((r) => r.d > 0.7).length, picked: picks.map(({ photo, ...o }) => o) }, null, 1) + '\n');
console.log(picks.length);
