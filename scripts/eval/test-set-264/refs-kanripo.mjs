#!/usr/bin/env node
// #264 stage 2, Chinese: Kanripo's Wenyuange (WYG) text for the frame's Siku Quanshu pages.
// PRIOR ART: scripts/eval/zh-skqs-5568-kanripo.mjs (workInfo, pbPages, juanRange, nearJuan, best, fold: imported;
// it established that WYG transcribes the Wenyuange copy our Siku scans are of, half-leaf by `<pb>`) and
// scripts/eval/ground-truth-5935/kanripo.mjs (the leaf rule: a page's own Kanripo page at Dice >= 0.6, else the
// page between two trusted neighbours). Both draw their OWN pages; this takes the sealed frame's drawn rows as
// they are and only looks for their leaf. Our stored reading is used to LOCATE the leaf, never as its text.
//
// READ-ONLY: Mongo reads (books, pages), GitHub raw reads (cached in /root/zh-skqs-5568/gh). $0, no model call.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/test-set-264/refs-kanripo.mjs --out=$JOB_SCRATCH/kanripo-cands.jsonl
// Writes candidates (one per drawn CJK row: located with its Kanripo half-leaf, or the reason it was not).
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages, juanRange, nearJuan, best, fold } from '../zh-skqs-5568-kanripo.mjs';
import { readFrame } from './refs-lib.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out', `${process.env.JOB_SCRATCH || '/tmp'}/kanripo-cands.jsonl`);
const TRUST = 0.6;
const CELLS = /^(zh-|chinese-|other-cjk)/;

const rows = readFrame().filter((r) => r.drawn && CELLS.test(r.frame_cell));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const textOf = (p) => fold(p?.ocr?.data || '');
const out = [];
for (const r of rows) {
  const base = { row: r.row, frame_cell: r.frame_cell, reserve: r.reserve, book_id: r.book_id, page_id: r.page_id, page_number: r.page_number };
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { _id: 0, work_id: 1, title: 1, published: 1, 'image_source.provider': 1, 'image_source.identifier': 1 } });
  const kr = String(book?.work_id || '').match(/^kr:(KR\w+)/)?.[1];
  if (!kr) { out.push({ ...base, outcome: 'no-etext', why: `no Kanripo work id (work_id ${book?.work_id ?? 'none'}): ${String(book?.title || '').slice(0, 60)}` }); continue; }
  const w = await workInfo(kr);
  if (!w.repo) { out.push({ ...base, kr, outcome: 'no-etext', why: 'no Kanripo repository' }); continue; }
  if (w.witness !== 'WYG') { out.push({ ...base, kr, outcome: 'other-edition', why: `Kanripo has no WYG branch (witness ${w.witness}); master is another edition than the Wenyuange copy` }); continue; }
  const juans = nearJuan(w, juanRange(book.title));
  const pages = await pbPages(kr, 'WYG', juans);
  if (!pages.length) { out.push({ ...base, kr, outcome: 'no-etext', why: 'no WYG juan file for the title range' }); continue; }
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number, r.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).toArray();
  const pn = (n) => near.find((p) => p.page_number === n);
  const own = textOf(pn(r.page_number));
  let loc = null;
  if (own.length >= 20) { const b = best(own, pages); if (b && b.dice >= TRUST) loc = { i: b.i, dice: b.dice, second: b.second, rule: 'own-page' }; }
  if (!loc) {
    const prev = textOf(pn(r.page_number - 1)), next = textOf(pn(r.page_number + 1));
    const bp = prev.length >= 20 ? best(prev, pages) : null, bn = next.length >= 20 ? best(next, pages) : null;
    if (bp?.dice >= TRUST && bn?.dice >= TRUST && bn.i - bp.i === 2) loc = { i: bp.i + 1, dice: null, second: null, rule: 'between-neighbours', neighbours: [bp.dice, bn.dice] };
  }
  // Siku volume titles can name the wrong juan range; a page not found near it is looked for in every WYG
  // juan file of the work, with a margin over the runner-up so a formulaic page cannot land on its twin.
  let pagesUsed = pages;
  if (!loc && juans.length < w.juan_files.length && own.length >= 20) {
    const all = await pbPages(kr, 'WYG', w.juan_files);
    const b = best(own, all);
    if (b && b.dice >= TRUST && b.dice - b.second >= 0.15) { loc = { i: b.i, dice: b.dice, second: b.second, rule: 'own-page-all-juan' }; pagesUsed = all; }
  }
  if (!loc) { out.push({ ...base, kr, outcome: 'unlocated', why: `own reading ${own.length} Han chars; no Kanripo half-leaf at Dice >= ${TRUST} and no two trusted neighbours` }); continue; }
  const p = pagesUsed[loc.i];
  out.push({ ...base, kr, outcome: 'located', title: book.title, published: book.published ?? null, provider: book.image_source?.provider ?? null, ia_id: book.image_source?.identifier ?? null,
    witness_sha: w.witness_sha, pb: p.pb, juan: p.juan, loc, raw: p.raw, folded: p.text, image_url: r.image?.url ?? null,
    control_folded: (pagesUsed[loc.i + 1] || pagesUsed[loc.i - 1])?.text ?? null,
    source_url: `https://github.com/kanripo/${kr}/blob/${w.witness_sha}/${kr}_${String(p.juan).padStart(3, '0')}.txt` });
}
await client.close();
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = out.reduce((a, o) => { const k = `${o.frame_cell}|${o.outcome}`; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log(JSON.stringify(tally, null, 1));
