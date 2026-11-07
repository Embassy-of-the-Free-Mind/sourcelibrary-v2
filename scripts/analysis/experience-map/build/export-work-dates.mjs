#!/usr/bin/env node
/**
 * Work dates for the books behind the aliveness atlas (#6652), from books.source_work_dates_meta (schema 2, written by
 * the library-dating runs, #6721). READ-ONLY. Writes <data-dir>/work-dates.json: { book_id: { y, from, to, display,
 * basis, confidence, ey (edition year), eb (edition basis) } }, which build-aliveness.py joins onto every map point.
 * PRIOR ART: build/export-atlas-books.mjs — same id set and Mongo read; it exports inputs FOR dating, this exports the
 * dates themselves.
 * Also writes <data-dir>/book-visibility.json: { book_id: hidden_reason } for every book a hit came from that readers
 * cannot open (visible !== true), which build-aliveness.py drops, so no passage on the page links to a 404.
 *   node --env-file=<main>/.env.production.local build/export-work-dates.mjs <data-dir>
 */
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const D = process.argv[2]; if (!D) { console.error('usage: export-work-dates.mjs <data-dir>'); process.exit(2); }
const { MongoClient } = createRequire(path.join(process.env.HOME, 'sourcelibrary', 'package.json'))('mongodb');
const P = JSON.parse(fs.readFileSync(path.join(D, 'aliveness-data.json'), 'utf8'));
const ids = [...new Set(P.map((p) => (p.u.match(/book\/([^?]+)/) || [])[1]).filter(Boolean))];
// every book a hit came from, not only those on the current map: a book hidden last run must be able to come back
for (const f of ['classified-aliveness.jsonl', 'classified-animism.jsonl']) {
  const p = path.join(D, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) if (l.trim()) { const id = JSON.parse(l).book_id; if (id && !ids.includes(id)) ids.push(id); }
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const vis = await c.db(process.env.MONGODB_DB || 'bookstore').collection('books').find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] }, { projection: { id: 1, visible: 1, hidden_reason: 1 } }).toArray();
const found = new Map(vis.map((d) => [d.id || String(d._id), d]));
const hidden = {};
for (const id of ids) { const d = found.get(id); if (!d) hidden[id] = 'not_found'; else if (d.visible !== true) hidden[id] = d.hidden_reason || 'hidden'; }
fs.writeFileSync(path.join(D, 'book-visibility.json'), JSON.stringify({ checked: ids.length, at: new Date().toISOString(), hidden }));
console.log(`${ids.length} hit books, ${Object.keys(hidden).length} not readable → book-visibility.json`);
const docs = await c.db(process.env.MONGODB_DB || 'bookstore').collection('books').find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: ids } }], 'source_work_dates_meta.schema': 2 },
  { projection: { id: 1, source_work_dates_meta: 1 } }).toArray();
await c.close();
const out = {};
for (const d of docs) {
  const m = d.source_work_dates_meta, w = m.work || {}, e = m.edition || {};
  if (!Number.isFinite(w.year)) continue;
  out[d.id || String(d._id)] = { y: w.year, from: w.from, to: w.to, display: w.display, basis: w.basis, confidence: m.confidence,
    ey: Number.isFinite(e.year) ? e.year : null, eb: e.basis || null };
}
fs.writeFileSync(path.join(D, 'work-dates.json'), JSON.stringify(out));
console.log(`${ids.length} atlas books, ${Object.keys(out).length} with a work date → work-dates.json`);
