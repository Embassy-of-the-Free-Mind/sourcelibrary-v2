// PRIOR ART: fetch-stored.mjs (this directory: E2's stored-OCR fetch; no neighbours). #7567 E5:
// neighbour images (prev/next leaf) of the E5 judged sample, for the #7522 judge's bleed check
import fs from 'node:fs'; import { MongoClient } from 'mongodb'; import { getPageSource } from '../../lib/page-image-url.mjs';
const J = process.argv[2]; const P = JSON.parse(fs.readFileSync(`${J}/e5/panel.json`, 'utf8')).pages;
const k = {}; const S = P.map((p) => ({ ...p, _k: (k[p.book_id] = (k[p.book_id] ?? -1) + 1) })).filter((p) => p._k % 3 === 0 && p._k <= 21);
fs.writeFileSync(`${J}/e5/judge-sample.txt`, S.map((p) => p.slug).join('\n') + '\n');
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore'); const rows = [];
for (const p of S) for (const d of [-1, 1]) {
  const n = await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number + d }, { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } });
  const u = n ? getPageSource(n) : null; if (u) rows.push({ slug: p.slug, side: d < 0 ? 'prev' : 'next', url: u });
}
fs.writeFileSync(`${J}/e5/nb.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); await c.close(); console.log(S.length, 'sample pages', rows.length, 'neighbours');
