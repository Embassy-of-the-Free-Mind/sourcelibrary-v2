#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/fetch-served.mjs reads one page's served English for a
// record list; builders choosing a page need to scan a book's pages first, which nothing here does.
/**
 * page-dump.mjs — read-only, $0. For builders choosing a held page to align (#6331).
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/canon-ref-6331/page-dump.mjs <book_id> --scan
 *       one line per page: page_number, OCR chars, has English, page-type tag, first 80 chars
 *   node ... page-dump.mjs <book_id> <page_number> [--english]
 *       the page's full stored OCR (exactly what an arm would translate), and with --english the stored English
 */
import { MongoClient } from 'mongodb';
const [bookId, arg, flag] = process.argv.slice(2);
if (!bookId || !arg) { console.error('usage: page-dump.mjs <book_id> --scan | <page_number> [--english]'); process.exit(1); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
if (arg === '--scan') {
  for await (const p of pages.find({ book_id: bookId }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 })) {
    const t = p.ocr?.data || '';
    const pt = (t.match(/<page-type>([^<]*)<\/page-type>/) || [])[1] || '';
    const body = t.replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log([p.page_number, t.length, p.translation?.data ? 'EN' : '--', pt, body.slice(0, 80)].join('\t'));
  }
} else {
  const p = await pages.findOne({ book_id: bookId, page_number: Number(arg) }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1 } });
  if (!p) console.error('no such page'); else { console.log(p.ocr?.data || ''); if (flag === '--english') console.log('\n===== STORED ENGLISH =====\n' + (p.translation?.data || '(none)')); }
}
await c.close();
