// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
// Stored reads for the ground-truth pages: lite (prior revision), Flash served pre-tiebreak, Pro (tie-break file).
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const PAGES = '154 166 446 430 133 259 344 391 204 300 91 194 315 284'.split(' ').map((p) => ['6a30825e675ed2bdbe36f107', +p])
  .concat('724 193 766 648 234 243 403 167 233 760 206 432 601 155 174 284 521 752'.split(' ').map((p) => ['6a308257675ed2bdbe36eddd', +p]));
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const out = [];
for (const [book_id, page_number] of PAGES) {
  const p = await db.collection('pages').findOne({ book_id, page_number }, { projection: { id: 1, ocr: 1 } });
  const revs = await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr' }).sort({ created_at: -1 }).toArray();
  const pre = revs.find((r) => r.reason === 'negation-tiebreak-6184');
  const lite = revs.find((r) => (r.model || r.meta?.model || '').includes('lite'));
  const pro = JSON.parse(fs.readFileSync(`/root/tattva-6184/reads/${p.id}.json`, 'utf8'));
  out.push({ book_id, page_number, page_id: p.id, flash: pre ? pre.data : p.ocr.data, flash_model: p.ocr.model, lite: lite?.data ?? null, lite_keys: lite ? Object.keys(lite) : null, pro: pro.text });
}
fs.writeFileSync('texts.json', JSON.stringify(out, null, 1));
console.log(out.map((o) => `${o.book_id.slice(-4)}:${o.page_number} lite=${!!o.lite} ${o.flash_model}`).join('\n'));
console.log(out[0].lite_keys);
await c.close();
