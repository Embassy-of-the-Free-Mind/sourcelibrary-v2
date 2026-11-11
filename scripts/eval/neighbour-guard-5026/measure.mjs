#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/door-refusals.mjs — the false-refusal count for a door change over a random
// $sample of pages; it runs assessTranslationHealth on one page alone. This runs the neighbour check, which needs each
// page's n-1 / n+1 and the book's K, so it reads those per page. Reads only: no page is written.
/**
 * Size the write-time neighbour guard (#5026) before it ships:
 *  - CLEAN: a random draw of pages that hold English and OCR; each page's stored English is put through
 *    neighbourVerdict as if it were being written again, against its stored neighbours and its book's K. Every refusal
 *    is listed for reading by eye (a random draw holds a few real leaks: 0.02-0.11% of pairs, #5026).
 *  - POSITIVE: L'escole des filles (feedback 6aeff0e1e94c27b5c3c82d3b), as stored; Atalanta Fugiens' 21 receiving pages
 *    as they were before the 2026-09-24 repair (their page_revisions 'anomaly-fix' rows), against today's neighbours.
 *
 *   node --env-file=.env.production.local scripts/eval/neighbour-guard-5026/measure.mjs --out=FILE [--n=2000] [--ids=FILE]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { neighbourVerdict, bookLengthRatioK } from '../../lib/neighbour-guard.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const N = Number(arg('n', 2000));
const ESCOLE = '6a29c8ce31e3615cd1c4991d', ATALANTA = '69520c46ab34727b1f044141';

const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const pages = db.collection('pages');
const P = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 };

async function judge(p, en = p.translation.data) {
  const near = await pages.find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: P }).toArray();
  const side = (m) => { const q = near.find((x) => x.page_number === m); return q ? { src: q.ocr?.data ?? '', en: q.translation?.data ?? '' } : null; };
  const k = await bookLengthRatioK(db, p.book_id);
  const v = neighbourVerdict({ page: { src: p.ocr?.data ?? '', en, type: p.page_type ?? null }, prev: side(p.page_number - 1), next: side(p.page_number + 1), k });
  return { page_id: p.id, book_id: p.book_id, page: p.page_number, type: p.page_type ?? null, src_chars: (p.ocr?.data ?? '').length, en_chars: en.length, k: k == null ? null : +k.toFixed(3), ...v };
}

async function pool(items, fn, width = 8) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}

// POSITIVE
const escole = await pages.find({ book_id: ESCOLE, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } }, { projection: P }).sort({ page_number: 1 }).toArray();
const escoleV = await pool(escole, (p) => judge(p));
const atPages = await pages.find({ book_id: ATALANTA }, { projection: P }).toArray();
const atById = new Map(atPages.map((p) => [p.id, p]));
const revs = await db.collection('page_revisions').find({ page_id: { $in: atPages.map((p) => p.id) }, field: 'translation', reason: 'anomaly-fix', created_at: { $gte: new Date('2026-09-24T16:00Z'), $lt: new Date('2026-09-24T17:00Z') } }, { projection: { page_id: 1, data: 1 } }).toArray();
const atalantaV = await pool(revs, (r) => judge(atById.get(r.page_id), r.data));

// CLEAN
// --ids=FILE (lines "book_id:page_number"): judge these pages instead of a random draw (re-scoring a labelled set).
const IDS = arg('ids');
const draw = IDS ? (await Promise.all(fs.readFileSync(IDS, 'utf8').split('\n').filter(Boolean).map((l) => { const [b, n] = l.trim().split(':'); return pages.findOne({ book_id: b, page_number: Number(n) }, { projection: P }); }))).filter(Boolean) : await pages.aggregate([
  { $sample: { size: N * 3 } },
  { $match: { 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' }, page_number: { $gt: 0 }, book_id: { $nin: [ESCOLE, ATALANTA] } } },
  { $limit: N },
  { $project: P },
]).toArray();
const cleanV = await pool(draw.filter((p) => p.translation.data.trim()), (p) => judge(p));
await c.close();

const tally = (vs) => ({ n: vs.length, refused: vs.filter((v) => v.refuse).length, leak: vs.filter((v) => v.reason === 'neighbour-leak').length, absorbs: vs.filter((v) => v.reason === 'absorbs-neighbour').length, k_null: vs.filter((v) => v.k == null).length });
const summary = { at: new Date().toISOString(), clean: tally(cleanV), escole: { ...tally(escoleV), refused_pages: escoleV.filter((v) => v.refuse).map((v) => `${v.page} ${v.reason} ${v.side}`) }, atalanta: { ...tally(atalantaV), missed: atalantaV.filter((v) => !v.refuse).map((v) => v.page) } };
fs.writeFileSync(path.resolve(arg('out')), JSON.stringify({ summary, clean_refused: cleanV.filter((v) => v.refuse), escole: escoleV, atalanta: atalantaV, clean: cleanV.map(({ detail, ...v }) => v) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
