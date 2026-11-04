#!/usr/bin/env node
// PRIOR ART: ./oc-set.mjs (correct.mjs's manifest.jsonl for a fixed sample, and the stored-text check) — it reads the
//   Latin sample.json; this builds a language's sample from w-draw's candidates and the format screen, then writes the
//   same manifest for correct.mjs and the page-ids file for cli-ocr.mjs read (#7568).
// w-set.mjs — LANG7568=<lang>. Reads $JOB_SCRATCH/<lang>/draw/candidates.json and $JOB_SCRATCH/<lang>/screen.json
//   ({book_id: {pass, why}}); the first 10 candidates that pass are the sample. Writes results-7568/<lang>/{sample.json,
//   screen.json, stored-check.json}, $JOB_SCRATCH/<lang>/set/manifest.jsonl and $JOB_SCRATCH/<lang>/page-ids.json.
//   A page whose stored ocr.data no longer equals the drawn lite text is left out and listed. Reads Mongo only.
import fs from 'node:fs'; import path from 'node:path';
import { MongoClient } from 'mongodb';
const L = process.env.LANG7568, S = path.join(process.env.JOB_SCRATCH, L), HERE = path.dirname(new URL(import.meta.url).pathname);
const R = path.join(HERE, 'results-7568', L); fs.mkdirSync(R, { recursive: true });
const cand = JSON.parse(fs.readFileSync(path.join(S, 'draw/candidates.json'), 'utf8'));
const screen = JSON.parse(fs.readFileSync(path.join(S, 'screen.json'), 'utf8'));
const books = cand.candidates.filter(b => screen[b.book_id]?.pass).slice(0, 10);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const all = books.flatMap(b => b.pages.filter(p => !p.err).map(p => ({ ...p, book_id: b.book_id })));
const stored = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all.map(p => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray()).map(p => [p.id, p]));
await c.close();
const keep = new Set(), mismatch = [];
for (const p of all) {
  const lite = fs.readFileSync(path.join(S, 'draw', `${p.slug}.lite.txt`), 'utf8'), s = stored.get(p.page_id);
  if (!s || (s.ocr?.data ?? '') !== lite) mismatch.push({ slug: p.slug, found: !!s }); else keep.add(p.page_id);
}
const sample = { lang: L, seed: cand.seed, frame_n: cand.frame_n, drawn_at: new Date().toISOString(),
  books: books.map(b => ({ ...b, pages: b.pages.filter(p => keep.has(p.page_id)) })) };
const manifest = sample.books.flatMap(b => b.pages.map(p => ({ page_id: p.page_id, book_id: b.book_id, slug: p.slug, page_number: p.page_number, why: `correct-vs-reread-7568 ${L} sample`, stored_model: p.ocr_model })));
fs.mkdirSync(path.join(S, 'set'), { recursive: true });
fs.writeFileSync(path.join(S, 'set/manifest.jsonl'), manifest.map(m => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(S, 'page-ids.json'), JSON.stringify(manifest.map(m => m.page_id)));
fs.writeFileSync(path.join(R, 'sample.json'), JSON.stringify(sample, null, 1));
fs.writeFileSync(path.join(R, 'screen.json'), JSON.stringify(screen, null, 1));
fs.writeFileSync(path.join(R, 'stored-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), pages: all.length, match: keep.size, mismatch }, null, 1));
console.log(JSON.stringify({ lang: L, books: sample.books.length, pages: manifest.length, mismatch: mismatch.length, img_errors: books.flatMap(b => b.pages).filter(p => p.err).length }));
