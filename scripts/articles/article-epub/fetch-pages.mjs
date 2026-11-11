// Reads each cited page (refs.txt: "<book-slug>?page=N" per line) from Mongo, read-only.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(`${process.argv[2]}/package.json`);
const { MongoClient } = require('mongodb');
const { getTranslationText } = await import(`${process.argv[2]}/scripts/lib/translation-text.mjs`);
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db(process.env.MONGODB_DB);
try {
  for (const r of fs.readFileSync('refs.txt', 'utf8').trim().split('\n').filter(Boolean)) {
    const [slug, q] = r.split('?page='); const n = +q;
    const b = await db.collection('books').findOne({ slug }, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1 } });
    if (!b) { console.error('no book', slug); continue; }
    const p = await db.collection('pages').findOne({ book_id: b.id, page_number: n }, { projection: { 'ocr.data': 1, translation: 1, printed_page: 1 } });
    fs.writeFileSync(`pages/${slug}-${n}.json`, JSON.stringify({
      translation: getTranslationText(p), original: p?.ocr?.data, page: n, printed_page: p?.printed_page,
      title: b.display_title || b.title, author: b.author, published: b.published, language: b.language,
    }));
  }
} finally { await c.close(); }
