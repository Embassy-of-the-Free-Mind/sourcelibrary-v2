// PRIOR ART: scripts/eval/translation-vs-reference/fetch-served.mjs reads the page's served translation; it does not read
// the BOOK's edition year, provider and scan licence, which Addendum A (#5695) wants recorded per scored page.
/** book-meta.mjs <records.jsonl> <out.json> — per page: edition title/year, provider, scan licence, served image URL, OCR model (read-only). */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const recs = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const out = {};
for (const r of recs) {
  const b = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, languages: 1, image_source: 1, license: 1, rights_status: 1, rights_note: 1, commons_license: 1, collections: 1, pages_count: 1, translated_count: 1 } });
  const p = await db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { photo: 1, photo_original: 1, display_photo: 1, archived_photo: 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'translation.updated_at': 1, 'ocr.source': 1, 'translation.ocr_hash': 1 } });
  out[`${r.book_id}_${String(r.page_number).padStart(5, '0')}`] = { title: b?.display_title || b?.title, author: b?.author, published: b?.published ?? b?.year, language: b?.language, provider: b?.image_source?.provider, image_license: b?.image_source?.license ?? b?.image_source?.rights ?? null, license: b?.license ?? null, rights_status: b?.rights_status ?? null, commons_license: b?.commons_license ?? null, pages_count: b?.pages_count, translated_count: b?.translated_count, photo: p?.display_photo || p?.archived_photo || p?.photo, ocr_model: p?.ocr?.model, ocr_updated: p?.ocr?.updated_at, tr_updated: p?.translation?.updated_at, ocr_source: p?.ocr?.source };
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
await c.close();
