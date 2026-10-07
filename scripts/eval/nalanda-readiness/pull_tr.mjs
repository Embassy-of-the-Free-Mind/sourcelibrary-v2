// PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs builds a multi-arm Tibetan packet from fresh runs; this pulls the SERVED English of 3 Sanskrit books.
// Pull 3 translated pages per book (seeded, spread through the book) for the Sanskrit fidelity judge.
import { MongoClient } from 'mongodb';
import fs from 'fs';
const BOOKS = { yogasutra: '69935b4d8e28d8f4c5d3cfaa', brahmasutra: '699258c28812793469fdd6be', manu: '6a06657a64d4bf2ce5510151' };
let seed = 930; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
fs.mkdirSync('judge/pages', { recursive: true });
for (const [k, id] of Object.entries(BOOKS)) {
  const ps = await pages.find({ book_id: id, 'translation.data': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, photo: 1 } }).sort({ page_number: 1 }).toArray();
  const ok = ps.filter(p => (p.ocr?.data || '').length > 800 && (p.translation?.data || '').length > 400);
  const n = ok.length; const picks = [0.25, 0.5, 0.75].map(f => ok[Math.min(n - 1, Math.floor(n * f + rnd() * n * 0.1))]);
  for (const p of picks) {
    fs.writeFileSync(`judge/pages/${k}_${p.page_number}.json`, JSON.stringify({ work: k, book_id: id, page_number: p.page_number, url: `https://sourcelibrary.org/book/${id}?page=${p.page_number}`, photo: p.photo, source: p.ocr.data, english: p.translation.data, english_model: p.translation.model || null }, null, 1));
  }
  console.log(k, n, picks.map(p => p.page_number));
}
await c.close();
