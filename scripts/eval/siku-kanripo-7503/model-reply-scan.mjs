#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/refusals.mjs (API refusal reasons from a meter; it never reads a stored text for a
// model's REPLY sentence) and scripts/lib/blank-page-guard.mjs (blank leaves). Neither catches PaddleOCR-VL writing
// a chat model's stock reply ("作为一个人工智能语言模型…") into a page's OCR, found by eye on #7503.
//
// #7503: count stored Paddle OCR that carries a chat-model reply sentence. READ-ONLY.
//   node --env-file=… scripts/eval/siku-kanripo-7503/model-reply-scan.mjs [--books=draw.json] [--all]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

export const MODEL_REPLY = /作为一个?人工智能|人工智能语言模型|我还没学习如何回答|我无法回答|作為一個人工智能|AI\s*语言模型/;
const arg = (n) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const pages = c.db('bookstore').collection('pages');
const q = { 'ocr.source': 'paddle', 'ocr.data': { $regex: MODEL_REPLY.source } };
let ids;
if (arg('books')) ids = JSON.parse(fs.readFileSync(arg('books'), 'utf8')).books.map((b) => b.book_id);
else if (process.argv.includes('--all')) ids = (await c.db('bookstore').collection('books').find({ language: /Chinese|^zh/i }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id);
else { console.error('pass --books=draw.json or --all'); process.exit(1); }
// per batch of books (book_id is indexed): one regex over all paddle pages times out (#7503)
const hits = [];
for (let i = 0; i < ids.length; i += 100) {
  hits.push(...await pages.find({ ...q, book_id: { $in: ids.slice(i, i + 100) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray());
  if (i % 2000 === 0) console.error(`${i}/${ids.length} books, ${hits.length} hits`);
}
const byBook = {};
for (const h of hits) (byBook[h.book_id] ||= []).push(h.page_number);
console.log(JSON.stringify({ books_scanned: ids.length, pages: hits.length, books: Object.keys(byBook).length, translated: hits.filter((h) => h.translation?.data).length,
  sample: hits.slice(0, 20).map((h) => ({ book_id: h.book_id, pn: h.page_number, match: h.ocr.data.match(MODEL_REPLY)?.[0], has_english: !!h.translation?.data })), by_book: byBook }, null, 1));
await c.close();
