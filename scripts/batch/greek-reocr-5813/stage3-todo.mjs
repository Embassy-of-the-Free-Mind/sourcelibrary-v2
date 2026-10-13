#!/usr/bin/env node
// Stage 3 of #5813 — what is still to submit. From stage3-pick's list, keeps the pages that are
// STILL served by flash-lite and were not already tried by this job with a real refusal (RECITATION,
// token limit, loop guard: raw-parts.jsonl rows with one text part or none). Pages whose answer came
// in several parts were stored cut off and put back (restore-truncated.mjs); they are tried again.
// Writes one id file per group, in spend order: A visible books of the 4 October list, D its hidden
// books, C books released from the ocr-untrusted-5700 hold. Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/stage3-todo.mjs --dir=DIR [--streams=3]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg('dir'), STREAMS = Number(arg('streams', '3'));
const rows = fs.readFileSync(`${DIR}/stage3-rows.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const tried = new Set(fs.existsSync(`${DIR}/raw-parts.jsonl`) ? fs.readFileSync(`${DIR}/raw-parts.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.page_id && r.text_parts <= 1).map((r) => r.page_id) : []);
// Pages put back to the lite text on purpose (restore-pages.mjs) are not tried again.
const restoredOnPurpose = new Set();
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const P = c.db('bookstore').collection('pages');
const lite = new Set();
const ids = rows.map((r) => r.page_id);
for (let i = 0; i < ids.length; i += 5000) {
  for (const p of await P.find({ id: { $in: ids.slice(i, i + 5000) }, 'ocr.model': /flash-lite/, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, { projection: { _id: 0, id: 1, 'ocr.restored.reason': 1 } }).toArray()) { lite.add(p.id); if (p.ocr?.restored?.reason && !/truncated/.test(p.ocr.restored.reason)) restoredOnPurpose.add(p.id); }
}
await c.close();
const groups = { A: [], D: [], C: [] };
const t = { done_or_changed: 0, tried_refused: 0 };
for (const r of rows) {
  if (!lite.has(r.page_id)) { t.done_or_changed++; continue; }
  if (tried.has(r.page_id) || restoredOnPurpose.has(r.page_id)) { t.tried_refused++; continue; }
  groups[r.released_hold ? 'C' : r.visible ? 'A' : 'D'].push(r);
}
for (const [g, list] of Object.entries(groups)) {
  // Whole books per stream, largest first, so streams finish together and no book is split.
  const per = {}; for (const r of list) per[r.book_id] = (per[r.book_id] || 0) + 1;
  const load = Array(STREAMS).fill(0), of = {};
  for (const b of Object.keys(per).sort((x, y) => per[y] - per[x])) { const i = load.indexOf(Math.min(...load)); of[b] = i; load[i] += per[b]; }
  const out = Array.from({ length: STREAMS }, () => []);
  for (const r of list) out[of[r.book_id]].push(r.page_id);
  out.forEach((x, i) => fs.writeFileSync(`${DIR}/todo-${g}-${i + 1}.json`, JSON.stringify(x)));
  t[g] = { pages: list.length, books: Object.keys(per).length, est_usd: +(list.reduce((s, r) => s + 0.00107 + (r.ocr_len / 2806) * 1694 * 1.5e-6 * 0.92, 0)).toFixed(2) };
}
console.log(JSON.stringify(t));
