#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs pageOf (the page rule; its frameFor takes only the Flash-Lite
// German/French/Latin cells, and refuses this one) and scripts/eval/lane-judge-sampler.mjs scriptClass (print or
// manuscript, imported). Neither counts a frame by model, tag and book across Chinese.
/**
 * The frame of #7263's Chinese re-read test: live Chinese pages whose ocr.model is gemini-3-flash-preview or
 * gemini-3.1-flash-lite*, by print / manuscript and by book. Read-only; one aggregate per book over pages_book_pagenum_idx.
 *   node --env-file=... scripts/eval/zh-gemini-reocr-7263/frame.mjs OUT.json
 */
import '../router-confirm/readonly-mongo.mjs';
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';

const MODEL_RE = '^(gemini-3-flash-preview|gemini-3\\.1-flash-lite)';
const out = process.argv[2];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: '^(Classical )?Chinese$' } },
  { projection: { id: 1, title: 1, language: 1, year: 1, pages_count: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'pipeline_auto.held': 1, 'pipeline_auto.hold_reason': 1 } }).toArray();
const rows = []; let i = 0;
await Promise.all(Array.from({ length: 16 }, async () => {
  while (i < books.length) {
    const b = books[i++];
    if (i % 1000 === 0) console.error(`${i}/${books.length}`);
    const r = await db.collection('pages').aggregate([
      { $match: { book_id: b.id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $regex: MODEL_RE } } },
      { $project: { _id: 0, m: '$ocr.model', st: '$script_type', tag: { $regexFind: { input: { $ifNull: ['$ocr.data', ''] }, regex: '<script>\\s*(printed|handwritten|mixed)', options: 'i' } }, human: { $cond: [{ $or: [{ $ne: [{ $type: '$ocr.edited_by' }, 'missing'] }, { $eq: ['$ocr.source', 'manual'] }] }, 1, 0] } } },
      { $project: { m: 1, human: 1, cls: { $cond: [{ $ne: ['$tag', null] }, { $toLower: { $arrayElemAt: ['$tag.captures', 0] } }, { $ifNull: ['$st', 'none'] }] } } },
      { $group: { _id: { m: '$m', cls: '$cls', human: '$human' }, n: { $sum: 1 } } }]).toArray();
    if (r.length) rows.push({ book_id: b.id, title: b.title, language: b.language, year: b.year ?? null, pages_count: b.pages_count, status: b.pipeline_auto?.status ?? null, hold: b.pipeline_auto?.hold ?? null, held: !!b.pipeline_auto?.held, counts: r.map((x) => ({ ...x._id, n: x.n })) });
  }
}));
await c.close();
const tot = { pages: 0, books: rows.length, by_model: {}, by_class: {}, by_model_class: {}, human: 0, by_hold: {} };
for (const b of rows) for (const x of b.counts) {
  tot.pages += x.n; tot.by_model[x.m] = (tot.by_model[x.m] ?? 0) + x.n; tot.by_class[x.cls] = (tot.by_class[x.cls] ?? 0) + x.n;
  const k = `${x.m} | ${x.cls}`; tot.by_model_class[k] = (tot.by_model_class[k] ?? 0) + x.n; tot.human += x.human * x.n;
  const h = b.hold ? 'hold' : b.held ? 'held' : (b.status ?? 'none'); tot.by_hold[h] = (tot.by_hold[h] ?? 0) + x.n;
}
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), books_scanned: books.length, tot, rows }, null, 1));
console.log(JSON.stringify(tot, null, 1));
