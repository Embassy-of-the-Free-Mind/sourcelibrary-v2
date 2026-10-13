#!/usr/bin/env node
/**
 * build-pareto-works.mjs — which WORK each Pareto page belongs to, so the charts' intervals resample works,
 * not pages (#6386). Two editions of one text are one observation; a page bootstrap over them is too narrow.
 *
 * PRIOR ART: scripts/eval/build-ocr-pareto.mjs and build-translation-pareto.mjs used each page's book (or the page
 * itself) as the unit and never looked up books.work_id. scripts/eval/results/xlref-synthesis-2026-10/build.mjs
 * resamples by book. None maps a book to its work, and the Pareto builders must stay Mongo-free (CI runs --check),
 * so the lookup is done once here and committed.
 *
 *   node --env-file=.env.production.local scripts/eval/build-pareto-works.mjs
 *
 * Read-only on Mongo (books: id / _id → work_id). Writes scripts/eval/results/pareto-works.json:
 *   { books: { <book id>: <work_id> | null } }, sorted, no timestamps.
 * A book with no work_id maps to null; the builders then use the book itself as the unit (the fallback the
 * issue names). A book Mongo does not find is also null, and counted in the log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, 'results');
const OUT = path.join(RES, 'pareto-works.json');
const ids = new Set();
const add = x => { if (typeof x === 'string' && /^[0-9a-f]{24}$/.test(x)) ids.add(x); };

// OCR: the sealed registries and the pinned ground truth carry book_id.
for (const f of fs.readdirSync(path.join(__dirname, 'benchmark')).filter(f => f.endsWith('.json'))) {
  const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', f), 'utf8')).pages;
  if (Array.isArray(pages)) for (const p of pages) add(p.book_id);
}
for (const f of fs.readdirSync(path.join(__dirname, 'ground-truth')).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
  add(JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-truth', f), 'utf8')).book_id);
}
// Translation: the #5695 tracks and the #6182 / #6331 packets.
const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
for (const f of ['xlref-t1-2026-10/rows.jsonl', 'xlref-t2-2026-10/pages.jsonl', 'xlref-t3-2026-10/pages.jsonl', 'xlref-t4-2026-10/pages.jsonl', 'xlref-t5-2026-10/pages.jsonl']) {
  for (const r of jsonl(path.join(RES, f))) add(r.book_id);
}
for (const f of ['pareto-6182/xljudge/scores.json', 'pareto-6182/claude/xljudge/scores.json', 'cli-arm-6182/xljudge/scores.json']) {
  for (const r of JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')).rows) add(r.book);
}

const books = {};
await withMongo(async db => {
  const list = [...ids];
  const docs = await db.collection('books').find(
    { $or: [{ id: { $in: list } }, { _id: { $in: list.map(i => new ObjectId(i)) } }] },
    { projection: { id: 1, work_id: 1 } },
  ).toArray();
  const byId = new Map();
  for (const d of docs) { const w = d.work_id ? String(d.work_id) : null; if (d.id) byId.set(String(d.id), w); byId.set(String(d._id), w); }
  for (const i of list.sort()) books[i] = byId.has(i) ? byId.get(i) : null;
  const found = list.filter(i => byId.has(i)).length, withWork = list.filter(i => byId.get(i)).length;
  console.log(`${list.length} books: ${found} found, ${withWork} with a work_id`);
});
fs.writeFileSync(OUT, JSON.stringify({ generated_by: 'scripts/eval/build-pareto-works.mjs', issue: 6386, books }, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
