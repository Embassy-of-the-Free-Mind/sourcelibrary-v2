#!/usr/bin/env node
// PRIOR ART: draw.mjs here (same frame: paddle_zh_reocr book events) — this only counts, per seeded book, the Paddle
// pages and how many carry a trusted own Kanripo leaf (qa_screen screened, dice >= 0.6) or any qa_screen, so the flag-rule
// projection can say how much of the lane a Kanripo-based signal could reach. READ-ONLY.
//   node --env-file=… coverage.mjs <n-books>   → coverage.json
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
const N = Number(process.argv[2] || 200);
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const ev = await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1 } }).toArray();
const books = [...new Set(ev.map((e) => e.book_id))].sort();
const r = makeRng(6563); for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
const t = { books: 0, paddle_pages: 0, qa_any: 0, qa_screened: 0, qa_trusted: 0, books_with_trusted: 0, status: {}, dice_hist: {} };
for (const bid of books.slice(0, N)) {
  const ps = await db.collection('pages').find({ book_id: bid, 'ocr.source': 'paddle' }, { projection: { _id: 0, 'ocr.qa_screen.status': 1, 'ocr.qa_screen.dice': 1 } }).toArray();
  t.books++; t.paddle_pages += ps.length; let k = 0;
  for (const p of ps) { const q = p.ocr?.qa_screen; if (q) { t.qa_any++; t.status[q.status] = (t.status[q.status] || 0) + 1; } if (q?.status === 'screened') { t.qa_screened++; const b = Math.min(0.95, Math.floor(q.dice * 20) / 20).toFixed(2); t.dice_hist[b] = (t.dice_hist[b] || 0) + 1; } if (q?.status === 'screened' && q.dice >= 0.6) { t.qa_trusted++; k++; } }
  if (k) t.books_with_trusted++;
}
await c.close();
t.frame_books = books.length; t.trusted_share = +(t.qa_trusted / t.paddle_pages).toFixed(4); t.screened_share = +(t.qa_screened / t.paddle_pages).toFixed(4);
fs.writeFileSync('coverage.json', JSON.stringify(t, null, 1)); console.log(JSON.stringify(t));
