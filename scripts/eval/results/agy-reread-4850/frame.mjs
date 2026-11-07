#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-ocr-per-call-6740/draw.mjs — draws its own page frame for a different question (per-call
// batching); this frame is the 506 (book, page) pairs of the #7945 token-run dry run, so it reads that report instead.
/**
 * The frame of #4850's gated agy re-read test: every (book, page) pair in the token-run dry-run report
 * (pages_by_reason.source_loop), with the book's language and the stored read's own <script> tag (handwritten vs
 * printed) to form the strata. Reads Mongo only; writes FRAME (default $JOB_SCRATCH/frame.json).
 *   node --env-file=.env.production.local scripts/eval/results/agy-reread-4850/frame.mjs REPORT.jsonl OUT.json
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { loopVerdict } from '../../../lib/ocr-loop-guard.mjs';
const [REPORT, OUT] = process.argv.slice(2);
const rows = fs.readFileSync(REPORT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const pairs = new Map();
for (const r of rows) for (const n of r.pages_by_reason?.source_loop || []) pairs.set(`${r.book}:${n}`, { book: r.book, page_number: n });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const bookIds = [...new Set([...pairs.values()].map((p) => p.book))];
const books = new Map((await db.collection('books').find({ $or: [{ id: { $in: bookIds } }, { _id: { $in: bookIds } }] }, { projection: { id: 1, title: 1, language: 1, visible: 1, pages_count: 1 } }).toArray()).map((b) => [b.id, b]));
const out = [];
for (const p of pairs.values()) {
  const pg = await db.collection('pages').findOne({ book_id: p.book, page_number: p.page_number }, { projection: { id: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.edited_by': 1, 'ocr.source': 1 } });
  const b = books.get(p.book);
  const t = pg?.ocr?.data || '';
  const hand = (t.match(/<script>\s*([\w-]+)\s*<\/script>/i)?.[1] || '').toLowerCase();
  const lv = loopVerdict(t);
  out.push({ ...p, page_id: pg?.id ?? null, language: b?.language ?? null, visible: b?.visible ?? null, hand, ms: hand === 'handwritten' || hand === 'mixed' ? 'MS' : hand === 'printed' ? 'print' : '?', ocr_model: pg?.ocr?.model ?? null, pipeline: pg?.ocr?.pipeline ?? null, human: !!(pg?.ocr?.edited_by || pg?.ocr?.source === 'manual'), image: pg?.archived_photo ?? null, chars: t.length, loop_refuse: !!lv.refuse });
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const tab = {}; for (const r of out) { const k = `${r.language} ${r.ms}`; tab[k] = (tab[k] || 0) + 1; }
console.log(out.length, 'pages;', out.filter((r) => !r.page_id).length, 'not found;', out.filter((r) => !r.loop_refuse).length, 'no longer refused by loopVerdict');
console.log(Object.entries(tab).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
await c.close();
