#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t4/page-tool.mjs (#5695 T1, same tool, copied so T4 does not depend on an unmerged sibling branch); fetch-served.mjs adds the served arm to finished records but cannot list or dump pages for an alignment agent. Read-only.
/** Read-only page browser for the #5695 T4 reference alignment: list a book's pages, or dump one page's OCR, served English and image. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t4/page-tool.mjs list --book <id>
 *   node --env-file=… scripts/eval/xlref-t4/page-tool.mjs dump --book <id> --page <n> [--no-translation]
 *   node --env-file=… scripts/eval/xlref-t4/page-tool.mjs book --book <id>
 */
import { MongoClient } from 'mongodb';
const [cmd, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
const BOOK = opt('book');
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
try {
  if (cmd === 'book') {
    const b = await db.collection('books').findOne({ $or: [{ id: BOOK }, { _id: BOOK }] }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1, pages_translated: 1, image_source: 1, image_license: 1, contributing_library: 1, publisher: 1, place_published: 1 } });
    console.log(JSON.stringify(b, null, 1));
  } else if (cmd === 'list') {
    const cur = db.collection('pages').find({ book_id: BOOK }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 });
    for await (const p of cur) {
      const o = strip(p.ocr?.data); const t = p.translation?.data || '';
      console.log(`${p.page_number}\t${p.page_type || ''}\tocr=${o.length}\ttr=${t.length}\t${o.slice(0, 90)}`);
    }
  } else if (cmd === 'dump') {
    const p = await db.collection('pages').findOne({ book_id: BOOK, page_number: Number(opt('page')) }, { projection: { page_number: 1, display_photo: 1, archived_photo: 1, photo: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1 } });
    if (!p) { console.log('no page'); process.exit(0); }
    console.log(`=== page ${p.page_number}  image: ${p.display_photo || p.archived_photo || p.photo}`);
    console.log(`=== OCR (${p.ocr?.model || '?'})\n${p.ocr?.data || ''}`);
    if (!rest.includes('--no-translation')) console.log(`\n=== SERVED ENGLISH (${p.translation?.model || '?'})\n${p.translation?.data || ''}`);
  } else console.log('commands: book | list | dump');
} finally { await c.close(); }
