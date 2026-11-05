#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer/draw-pages.mjs (#5942 phase 2) — the same seeded one-page-per-book draw
// (mulberry32 over books sorted by id, then a page from the book's translated pages). It writes into its own results
// folder, reads translations only, drops Tibetan and keeps no revision history; this one takes --field (translation or
// ocr), keeps every Tibetan book, and attaches each page's page_revisions rows for the anchor-survival measure.
/**
 * #5942 Part A — read-only. One page per book, seeded, with the page's revision history.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-layer-5942/draw.mjs --field translation --n 2000
 *   node --env-file=… scripts/eval/notes-layer-5942/draw.mjs --field ocr --n 1000
 *
 * Books: visible, pages_count > 0 (and pages_translated > 0 for translation). Output:
 *   $JOB_SCRATCH/a/<field>.jsonl          the stored text + revisions (not committed: it is the corpus)
 *   scripts/eval/results/notes-layer-5942/draw-<field>.jsonl   ids, hashes, revision counts (committed)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FIELD = opt('field', 'translation');
const N = Number(opt('n', FIELD === 'ocr' ? 1000 : 2000));
const SEED = Number(opt('seed', 5942));
const W = `${process.env.JOB_SCRATCH}/a`;
const R = new URL('../results/notes-layer-5942/', import.meta.url).pathname;
fs.mkdirSync(W, { recursive: true });
fs.mkdirSync(R, { recursive: true });

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const q = { visible: true, pages_count: { $gt: 0 } };
if (FIELD === 'translation') q.pages_translated = { $gt: 0 };
const books = await db.collection('books').find(q).project({ _id: 0, id: 1, language: 1 }).toArray();
const pool = books.filter((b) => b.id).sort((a, b) => (a.id < b.id ? -1 : 1));
// A different stream per field, so the OCR draw is not the translation draw's first books.
const rng = makeRng(SEED + (FIELD === 'ocr' ? 1 : 0));
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
console.log(`${FIELD}: ${pool.length} books in the frame`);

const key = `${FIELD}.data`;
const out = fs.createWriteStream(`${W}/${FIELD}.jsonl`);
const manifest = [];
let tried = 0;
for (const b of pool) {
  if (manifest.length >= N) break;
  tried++;
  const nums = (await db.collection('pages').find({ book_id: b.id, [key]: { $type: 'string', $ne: '' } }).project({ _id: 0, page_number: 1 }).toArray())
    .map((p) => p.page_number).sort((x, y) => x - y);
  if (!nums.length) continue;
  const pick = nums[Math.floor(rng() * nums.length)];
  const p = await db.collection('pages').findOne({ book_id: b.id, page_number: pick }, { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, [FIELD]: 1 } });
  const f = p?.[FIELD];
  if (!f?.data?.trim()) continue;
  const revs = await db.collection('page_revisions').find({ page_id: p.id, field: FIELD })
    .project({ _id: 0, data: 1, source: 1, model: 1, prompt_version: 1, created_at: 1, original_date: 1, job_id: 1 }).sort({ created_at: 1 }).toArray();
  const row = { book_id: b.id, page_id: p.id, page_number: pick, language: b.language ?? null, page_type: p.page_type ?? null, source: f.source ?? null, model: f.model ?? null, prompt_version: f.prompt_version ?? null, updated_at: f.updated_at ?? null };
  out.write(JSON.stringify({ ...row, data: f.data, revisions: revs.filter((r) => typeof r.data === 'string') }) + '\n');
  manifest.push({ ...row, chars: f.data.length, sha16: crypto.createHash('sha256').update(f.data).digest('hex').slice(0, 16), revisions: revs.length });
  if (manifest.length % 200 === 0) console.log(`${manifest.length} pages (${tried} books tried)`);
}
out.end();
await c.close();
fs.writeFileSync(`${R}draw-${FIELD}.jsonl`, manifest.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`drew ${manifest.length} ${FIELD} pages from ${tried} books (seed ${SEED}); with revisions: ${manifest.filter((m) => m.revisions).length}`);
