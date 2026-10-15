#!/usr/bin/env node
// PRIOR ART: scripts/lib/ocr-targeting.mjs (page-id files for the OCR writers; it selects by book and page range,
// not by which reader wrote the stored OCR) and scripts/maintenance/apply-reocr-verdicts.mjs (writes the #4523
// verdicts this reads). This lists the #6560 pass's frame: Yigdzin pages that are served.
/**
 *   node --env-file=... volume-ids.mjs order --out=ORDER.json      the frame's Kangyur volumes, oldest book first
 *   node --env-file=... volume-ids.mjs book --book=ID --out=F.json   one volume's page ids, in page order
 *
 * Frame (#6560, 2026-10-15): `ocr.pipeline = reocr_bdrc_4523`, `ocr.model = bdrc-yigdzin-v1`,
 * `ocr.verdict.verdict = SERVE`, not human-edited, in a book that is visible or pipeline-held. The pass runs on
 * Kangyur volumes (title names a Kanjur/Kangyur): the 30-folio evidence and the prompt are Kangyur's.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const FRAME = { 'ocr.pipeline': 'reocr_bdrc_4523', 'ocr.model': 'bdrc-yigdzin-v1', 'ocr.verdict.verdict': 'SERVE', 'ocr.edited_by': { $exists: false } };
const KANGYUR = /kanjur|kangyur|bka.? ?.?gyur/i;

const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await c.connect();
const db = c.db('bookstore');
if (CMD === 'order') {
  const agg = await db.collection('pages').aggregate([{ $match: FRAME }, { $group: { _id: '$book_id', n: { $sum: 1 } } }],
    { maxTimeMS: 900000, hint: { 'ocr.pipeline': 1, 'ocr.updated_at': 1 } }).toArray();
  const books = await db.collection('books').find({ id: { $in: agg.map((a) => a._id) } }, { projection: { id: 1, title: 1, visible: 1, created_at: 1, 'pipeline_auto.status': 1 } }).toArray();
  const n = Object.fromEntries(agg.map((a) => [a._id, a.n]));
  const order = books.filter((b) => (b.visible || b.pipeline_auto?.status === 'held') && KANGYUR.test(b.title || ''))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id))
    .map((b) => ({ book_id: b.id, title: b.title, pages: n[b.id], visible: !!b.visible }));
  fs.writeFileSync(arg('out'), JSON.stringify(order, null, 1));
  console.log(`${order.length} Kangyur volumes, ${order.reduce((s, b) => s + b.pages, 0)} pages`);
} else if (CMD === 'book') {
  const ps = await db.collection('pages').find({ book_id: arg('book'), ...FRAME }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
  fs.writeFileSync(arg('out'), JSON.stringify(ps.map((p) => p.id)));
  console.log(`${arg('book')}: ${ps.length} pages`);
} else {
  console.error('usage: volume-ids.mjs order|book (see the header)');
  process.exitCode = 2;
}
await c.close();
