#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/driver.mjs select (the manifest.jsonl shape correct.mjs reads) — it draws
//   its own pages by readership; this arm must use the 250 pages flash-reread-test-5924 already drew (results/sample.json).
// oc-set.mjs <set-dir> — the Opus-correction arm's set dir (#5924, PREREGISTRATION-opus-correct.md): manifest.jsonl
//   for the 250 sample pages, and a check that each page's stored ocr.data still equals the lite text the Flash test
//   judged ($FLASH_JOB/draw/<slug>.lite.txt). Mismatches are reported and left out of the manifest. Reads Mongo only.
import fs from 'node:fs'; import path from 'node:path';
import { MongoClient } from 'mongodb';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.resolve(process.argv[2] || ''); if (!process.argv[2]) { console.error('usage: oc-set.mjs <set-dir>'); process.exit(2); }
const FLASH = process.env.FLASH_JOB || '/data/scratch/sl/jobs/flash-reread-test-5924';
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results/sample.json'), 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const all = sample.books.flatMap((b) => b.pages.map((p) => ({ ...p, book_id: b.book_id })));
const stored = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();
const manifest = [], mismatch = [];
for (const p of all) {
  const lite = fs.readFileSync(path.join(FLASH, 'draw', `${p.slug}.lite.txt`), 'utf8');
  const s = stored.get(p.page_id);
  if (!s || (s.ocr?.data ?? '') !== lite) { mismatch.push({ slug: p.slug, page_id: p.page_id, found: !!s, stored_chars: s?.ocr?.data?.length ?? null, lite_chars: lite.length, stored_updated_at: s?.ocr?.updated_at ?? null }); continue; }
  manifest.push({ page_id: p.page_id, book_id: p.book_id, slug: p.slug, page_number: p.page_number, why: 'flash-reread-5924 sample', stored_model: s.ocr?.model ?? null });
}
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'pages.json'), JSON.stringify(manifest.map((m) => m.page_id)));
fs.writeFileSync(path.join(HERE, 'results/oc-stored-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), pages: all.length, match: manifest.length, mismatch }, null, 1));
console.log(JSON.stringify({ pages: all.length, match: manifest.length, mismatch: mismatch.length }), mismatch.slice(0, 5));
