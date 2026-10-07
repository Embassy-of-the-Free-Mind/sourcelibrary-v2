#!/usr/bin/env node
// PRIOR ART: scripts/export/training-pairs.mjs (#4322, the full export this samples from — it writes pairs, it does
// not exclude reference-set books or strip apparatus); scripts/eval/tuned-vs-base-eval.mjs (#4320, the August Vertex
// tune — its targets kept <note> apparatus, which the tune then learned). This file is the #5793 train/test split.
/**
 * Build the #5793 student train set and test set.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-student-5793/build-data.mjs \
 *     --presample /root/claude-jobs/data/latin-presample-5793.jsonl.gz --out /root/student-5793/data
 *
 * Train: the laptop pre-sample (train split, pre-filtered), minus every book_id AND work_id that occurs in any
 * translation reference set (xlref-*, human-ceiling-5762), targets cleaned with cleanTranslation(), re-screened on
 * length and ratio after cleaning, ordered round-robin across books (seeded) so a prefix is still spread over books.
 * Test: the 71 Latin pages of #5695 T1 (scripts/eval/results/xlref-t1-2026-10/records.jsonl), each with a published
 * human translation. Arm (a) is T1's `prod-A` (gemini-3.1-flash-lite, production call shape, all 71 pages).
 * Training pairs are private (#4320): the out dir must be outside the repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { cleanTranslation, PROMPT_VERSION } from './prompt.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PRESAMPLE = arg('--presample', '/root/claude-jobs/data/latin-presample-5793.jsonl.gz');
const OUT = arg('--out', '/root/student-5793/data');
const SEED = Number(arg('--seed', 5793));
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const RES = path.join(REPO, 'scripts/eval/results');
const T1 = path.join(RES, 'xlref-t1-2026-10/records.jsonl');
if (OUT.startsWith(REPO)) throw new Error('training pairs are private: --out must be outside the repo');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// 1. every book id named in a translation reference set
const refDirs = fs.readdirSync(RES).filter((d) => /^xlref-|^human-ceiling-5762/.test(d)).map((d) => path.join(RES, d));
const refBooks = new Set();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsonl?$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/"book_id"\s*:\s*"([^"]+)"/g)) refBooks.add(m[1]); } };
refDirs.forEach(walk);

// 2. their work_ids (a book is matched by id OR _id: 16K books carry a re-minted _id)
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const ids = [...refBooks];
const hex = ids.filter((x) => /^[0-9a-f]{24}$/.test(x));
const { ObjectId } = await import('mongodb');
const found = await books.find({ $or: [{ id: { $in: ids } }, { _id: { $in: hex.map((h) => new ObjectId(h)) } }] }, { projection: { id: 1, work_id: 1 } }).toArray();
await client.close();
const refWorks = new Set(found.map((b) => b.work_id).filter(Boolean));
for (const b of found) { refBooks.add(String(b._id)); if (b.id) refBooks.add(b.id); }

// 3. the test set
const test = readJsonl(T1);
for (const r of test) refBooks.add(r.book_id);

// 4. train
const rows = zlib.gunzipSync(fs.readFileSync(PRESAMPLE)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = { presample: rows.length, presample_books: new Set(rows.map((r) => r.book_id)).size, presample_works: new Set(rows.map((r) => r.work_id).filter(Boolean)).size,
  not_train_split: 0, excluded_book: 0, excluded_work: 0, short_after_clean: 0, ratio_after_clean: 0, kept: 0 };
const kept = [];
for (const r of rows) {
  if (r.split && r.split !== 'train') { c.not_train_split++; continue; }
  if (refBooks.has(r.book_id)) { c.excluded_book++; continue; }
  if (r.work_id && refWorks.has(r.work_id)) { c.excluded_work++; continue; }
  const target = cleanTranslation(r.translation_en);
  if (target.length < 300) { c.short_after_clean++; continue; }
  const ratio = target.length / r.source_text.length;
  if (ratio < 0.8 || ratio > 2.5) { c.ratio_after_clean++; continue; }
  kept.push({ book_id: r.book_id, work_id: r.work_id || null, page_id: r.page_id, year: r.year, source: r.source_text, target });
}
// round-robin across books, books and pages in seeded order
const rnd = mulberry32(SEED);
const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const byBook = new Map();
for (const r of kept) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
const queues = shuf([...byBook.values()].map(shuf));
// dev: one page from each of the first 20 books in that order, for the base-model choice; those books leave train
const dev = queues.slice(0, 20).map((q) => q[0]);
const devBooks = new Set(dev.map((r) => r.book_id));
const rest = queues.slice(20);
const train = [];
const nRest = rest.reduce((n, q) => n + q.length, 0);
for (let round = 0; train.length < nRest; round++) for (const q of rest) if (q[round]) train.push(q[round]);
for (const b of devBooks) byBook.delete(b);
c.dev_pages = dev.length;
c.kept = train.length;
c.train_books = byBook.size;
c.train_works = new Set(train.map((r) => r.work_id).filter(Boolean)).size;
c.ref_books_excluded_set = refBooks.size;
c.ref_works_excluded_set = refWorks.size;
c.test_pages = test.length;
c.test_books = new Set(test.map((r) => r.book_id)).size;
c.test_overlap_train_books = test.filter((r) => byBook.has(r.book_id)).length;
c.prompt_version = PROMPT_VERSION;
c.target_chars_median = train.map((r) => r.target.length).sort((a, b) => a - b)[train.length >> 1];
c.source_chars_median = train.map((r) => r.source.length).sort((a, b) => a - b)[train.length >> 1];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'train.jsonl'), train.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'dev.jsonl'), dev.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'test.jsonl'), test.map((r) => JSON.stringify({ book_id: r.book_id, page_number: r.page_number, source: r.source_text })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify(c, null, 1));
console.log(JSON.stringify(c, null, 1));
