#!/usr/bin/env node
// Stage 3 of #5813, printed only (Derek 2026-10-06) — build the page list from a FRESH select.mjs run.
// In: --dir (fresh pages.jsonl + books.json), --prev (the 2026-10-04 work dir: pilot-pages.json, books.json).
// Keeps pages of books classed printed; drops the 200 pilot pages, pages whose own script_type is
// handwritten (the pilot's invented page sat in a book classed printed), and books whose status the
// collector could move (ocr_submitted / ocr_complete: its RECITATION recovery resets them when a
// whole chunk is refused; recitation_retry_lite: third strike sets needs_attention) or that sit in
// loop quarantine. Books released from the ocr-untrusted-5700 hold on 2026-10-05 go LAST.
// Writes stage3-pages.json (ordered ids), stage3-rows.jsonl, stage3-skips.json. Read-only on Mongo.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DIR = arg('dir'), PREV = arg('prev');
const pages = fs.readFileSync(`${DIR}/pages.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const books = new Map(JSON.parse(fs.readFileSync(`${DIR}/books.json`)).map((b) => [b.id, b]));
const pilot = new Set(JSON.parse(fs.readFileSync(`${PREV}/pilot-pages.json`)));
const wasHeld = new Set(JSON.parse(fs.readFileSync(`${PREV}/books.json`)).filter((b) => b.held).map((b) => b.id));
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const flagged = new Set((await c.db('bookstore').collection('books').find({ id: { $in: [...books.keys()] }, 'pipeline_auto.recitation_retry_lite': true }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id));
await c.close();
const MOVABLE = new Set(['ocr_submitted', 'ocr_complete']);
const skip = {}; const note = (k, p) => { (skip[k] ??= { pages: 0, books: new Set(), translated: 0 }); skip[k].pages++; skip[k].books.add(p.book_id); if (p.tr) skip[k].translated++; };
const keep = [];
for (const p of pages) {
  const b = books.get(p.book_id);
  if (p.cls !== 'printed') { note(`book-class-${p.cls ?? 'none'}`, p); continue; }
  if (pilot.has(p.page_id)) { note('pilot-page', p); continue; }
  if (b.status === 'loop_quarantine_hold') { note('book-loop-quarantine', p); continue; }
  if (MOVABLE.has(b.status) || flagged.has(b.id)) { note('book-status-collector-could-move', p); continue; }
  if (p.script_type === 'handwritten') { note('page-handwritten-in-printed-book', p); continue; }
  keep.push({ ...p, released_hold: wasHeld.has(p.book_id), status: b.status });
}
const rank = (p) => (p.released_hold ? 2 : 0) + (p.visible ? 0 : 1);
keep.sort((a, b) => rank(a) - rank(b) || a.book_id.localeCompare(b.book_id) || a.n - b.n);
const cells = {};
for (const p of keep) { const k = `${p.released_hold ? 'released-hold' : 'stage1'}|${p.visible ? 'visible' : 'hidden'}`; (cells[k] ??= { books: new Set(), pages: 0, translated: 0 }); cells[k].books.add(p.book_id); cells[k].pages++; if (p.tr) cells[k].translated++; }
const flat = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { books: v.books.size, pages: v.pages, translated: v.translated }]));
const summary = { at: new Date().toISOString(), pages: keep.length, books: new Set(keep.map((p) => p.book_id)).size, translated: keep.filter((p) => p.tr).length, cells: flat(cells), skipped: flat(skip), by_status: keep.reduce((m, p) => (m[p.status] = (m[p.status] || 0) + 1, m), {}), page_script_type: keep.reduce((m, p) => (m[p.script_type] = (m[p.script_type] || 0) + 1, m), {}) };
fs.writeFileSync(`${DIR}/stage3-pages.json`, JSON.stringify(keep.map((p) => p.page_id)));
fs.writeFileSync(`${DIR}/stage3-rows.jsonl`, keep.map((p) => JSON.stringify(p)).join('\n') + '\n');
fs.writeFileSync(`${DIR}/stage3-summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
