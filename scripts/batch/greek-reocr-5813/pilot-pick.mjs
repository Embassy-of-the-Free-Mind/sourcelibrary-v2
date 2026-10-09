#!/usr/bin/env node
// Stage 2 of #5813 — pick the pilot: 200 pages, one per book, seeded, from select.mjs's pages.jsonl.
// Strata (book_class × visible) are filled in proportion to their page counts, at least one book each.
// A pilot page is a body page: OCR ≥ 400 chars, not flagged unreadable; a translated page is preferred.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) || '.';
const N = 200, SEED = 'greek-reocr-5813';
const h = (s) => createHash('sha256').update(SEED + s).digest('hex');
const pages = fs.readFileSync(`${DIR}/pages.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const byBook = new Map();
for (const p of pages) (byBook.get(p.book_id) || byBook.set(p.book_id, []).get(p.book_id)).push(p);
const strata = {};
for (const [id, ps] of byBook) {
  const ok = ps.filter((p) => p.ocr_len >= 400 && !p.unreadable);
  if (!ok.length) continue;
  const pool = ok.some((p) => p.tr) ? ok.filter((p) => p.tr) : ok;
  const pick = pool.sort((a, b) => h(a.page_id).localeCompare(h(b.page_id)))[0];
  const k = `${ps[0].cls}|${ps[0].visible ? 'visible' : 'hidden'}`;
  (strata[k] ??= { pages: 0, picks: [] }).pages += ps.length;
  strata[k].picks.push(pick);
}
const total = Object.values(strata).reduce((s, v) => s + v.pages, 0);
const chosen = [];
for (const [k, v] of Object.entries(strata)) {
  const want = Math.min(v.picks.length, Math.max(1, Math.round(N * v.pages / total)));
  v.picks.sort((a, b) => h(a.book_id).localeCompare(h(b.book_id)));
  chosen.push(...v.picks.slice(0, want));
  console.log(k, `books ${v.picks.length}, pages ${v.pages}, pilot ${want}`);
}
// top up to N from the largest strata's remaining books
const have = new Set(chosen.map((p) => p.book_id));
const rest = Object.values(strata).flatMap((v) => v.picks).filter((p) => !have.has(p.book_id)).sort((a, b) => h(a.book_id).localeCompare(h(b.book_id)));
while (chosen.length < N && rest.length) chosen.push(rest.shift());
fs.writeFileSync(`${DIR}/pilot-pages.json`, JSON.stringify(chosen.slice(0, N).map((p) => p.page_id)));
fs.writeFileSync(`${DIR}/pilot-rows.json`, JSON.stringify(chosen.slice(0, N)));
console.log(`pilot: ${Math.min(N, chosen.length)} pages, ${new Set(chosen.map((p) => p.book_id)).size} books, translated ${chosen.filter((p) => p.tr).length}`);
