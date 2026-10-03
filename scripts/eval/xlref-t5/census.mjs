// PRIOR ART: scripts/eval/results/translation-ab-5606-2026-10-02/backlog-cost.json (#5606 counted the
// untranslated backlog per language from pages); this counts TRANSLATED pages per language × period from
// books' cached counters (books only, no pages scan) to weight the T5 sample and price levers at scale.
/** T5 census: translated pages (books.pages_translated) for Sanskrit / Pali / classical Chinese, by period and visibility. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const LANGS = ['Sanskrit', 'Pali', 'Chinese', 'Classical Chinese', 'Literary Chinese'];
const rows = await db.collection('books').find({ language: { $in: LANGS } }, { projection: { language: 1, published: 1, year: 1, pages_translated: 1, pages_count: 1, visible: 1, title: 1 } }).toArray();
const yr = (b) => { const m = String(b.published ?? b.year ?? '').match(/-?\d{3,4}/); return m ? Number(m[0]) : null; };
const bucket = (y) => (y == null ? 'unknown' : y < 1500 ? '<1500' : y < 1800 ? '1500-1799' : y < 1900 ? '1800-1899' : y < 1950 ? '1900-1949' : '1950+');
const out = {};
for (const b of rows) {
  const L = /Chinese/.test(b.language) ? 'Chinese' : b.language;
  const k = bucket(yr(b));
  out[L] ??= { books: 0, translated_pages: 0, visible_translated_pages: 0, by_period: {} };
  const o = out[L]; o.books++; o.translated_pages += b.pages_translated || 0;
  if (b.visible && b.pages_count > 0) o.visible_translated_pages += b.pages_translated || 0;
  o.by_period[k] ??= { books: 0, translated_pages: 0 }; o.by_period[k].books++; o.by_period[k].translated_pages += b.pages_translated || 0;
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(process.argv[2], JSON.stringify({ measured_at: new Date().toISOString(), source: 'books.pages_translated by books.language (cached counters, no pages scan)', langs: LANGS, ...out }, null, 1));
await c.close();
