#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/fetch-served.mjs reads the same fields but also attaches the SERVED
// English; scripts/eval/lib/sampling.mjs getPage returns OCR only, without book metadata or neighbours. The #5695 T3
// reference cutters must align on the SOURCE without ever seeing our English (else the cut favours pages we got
// right), so this prints source-side fields only. Read-only.
/** Print a page's OCR (and the neighbouring pages' edges) plus book metadata — never the translation — for cutting a reference span blind (#5695 T3). */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t3/show-source.mjs <book_id> <page> [--edge 400] [--meta]
 */
import { MongoClient } from 'mongodb';
const [bookId, pageArg] = process.argv.slice(2);
const edgeI = process.argv.indexOf('--edge'); const EDGE = edgeI > 0 ? Number(process.argv[edgeI + 1]) : 400;
if (!bookId || !pageArg) { console.error('usage: show-source.mjs <book_id> <page> [--edge N] [--meta]'); process.exit(1); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
try {
  const db = c.db(process.env.MONGODB_DB || 'bookstore');
  if (process.argv.includes('--meta')) {
    const b = await db.collection('books').findOne({ $or: [{ id: bookId }] }, { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1, pages_translated: 1, image_source: 1, contributing_library: 1, place_published: 1, publisher: 1, work_title: 1 } });
    console.log('BOOK', JSON.stringify(b));
  }
  const n = Number(pageArg);
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [n - 1, n, n + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, page_type: 1, display_photo: 1, photo: 1 } }).toArray();
  const by = Object.fromEntries(pages.map((p) => [p.page_number, p]));
  if (by[n - 1]) console.log(`--- PREV p${n - 1} (last ${EDGE} chars) ---\n${String(by[n - 1].ocr?.data || '').slice(-EDGE)}`);
  const p = by[n];
  if (!p) console.log(`--- p${n}: NO PAGE ---`);
  else console.log(`--- PAGE p${n} type=${p.page_type || ''} ocr_model=${p.ocr?.model || ''} chars=${String(p.ocr?.data || '').length} image=${p.display_photo || p.photo || ''} ---\n${p.ocr?.data || '(no OCR)'}`);
  if (by[n + 1]) console.log(`--- NEXT p${n + 1} (first ${EDGE} chars) ---\n${String(by[n + 1].ocr?.data || '').slice(0, EDGE)}`);
} finally { await c.close(); }
