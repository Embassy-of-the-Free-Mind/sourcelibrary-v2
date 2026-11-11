// Reads each cited page (refs.txt: "<book-slug>?page=N" per line) from Mongo, read-only.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(`${process.argv[2]}/package.json`);
const { MongoClient } = require('mongodb');
const { getTranslationText } = await import(`${process.argv[2]}/scripts/lib/translation-text.mjs`);
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db(process.env.MONGODB_DB);
const gallery = {};
try {
  for (const r of fs.readFileSync('refs.txt', 'utf8').trim().split('\n').filter(Boolean)) {
    const [slug, q] = r.split('?page='); const n = +q;
    const b = await db.collection('books').findOne({ slug }, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, year: 1, 'image_source.provider': 1, 'image_source.license': 1, 'image_source.rights_normalized': 1 } });
    if (!b) { console.error('no book', slug); continue; }
    const p = await db.collection('pages').findOne({ book_id: b.id, page_number: n }, { projection: { translations: 0, translation_es: 0, transliteration: 0 } });
    fs.writeFileSync(`pages/${slug}-${n}.json`, JSON.stringify({
      translation: getTranslationText(p), original: p?.ocr?.data, page: n, printed_page: p?.printed_page,
      title: b.display_title || b.title, author: b.author, published: b.published, language: b.language,
      // For the scan: imageAccessFor(book) and pageExportImageUrl(page) in build.ts.
      book: { year: b.year, image_source: b.image_source }, pageDoc: { ...p, translation: undefined },
    }));
    // The book's illustrations (the gallery's crops), for the pictures that open each chapter (build.ts).
    if (!gallery[slug]) {
      gallery[slug] = {
        title: b.display_title || b.title, author: b.author, book: { year: b.year, image_source: b.image_source },
        images: await db.collection('gallery_images').find(
          { book_id: b.id, gallery_quality: { $gte: 0.6 }, extracted_url: { $ne: null }, type: { $nin: ['exlibris', 'bookplate'] } },
          { projection: { _id: 0, page_number: 1, extracted_url: 1, description: 1, gallery_quality: 1, type: 1 } },
        ).sort({ gallery_quality: -1 }).limit(40).toArray(),
      };
    }
  }
  fs.writeFileSync('gallery.json', JSON.stringify(gallery));
} finally { await c.close(); }
