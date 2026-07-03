#!/usr/bin/env node
/**
 * Generate a CSV of all books needing re-OCR and/or re-translation.
 * Usage: secret-lover run -- node scripts/generate-reprocessing-csv.mjs
 *    or: export $(grep MONGODB_URI .env.production | sed 's/"//g') && node scripts/generate-reprocessing-csv.mjs
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const TARGET = 'gemini-3-flash-preview';
const SKIP = ['manual', 'manual-correction'];

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');

// Per-book OCR stats
const bookStats = await db.collection('pages').aggregate([
  { $match: { 'ocr.data': { $exists: true, $ne: '' } } },
  { $group: {
    _id: '$book_id',
    total_ocr: { $sum: 1 },
    old_model_pages: { $sum: { $cond: [
      { $and: [
        { $ne: ['$ocr.model', TARGET] },
        { $not: { $in: ['$ocr.model', SKIP] } }
      ]}, 1, 0
    ]}},
    new_model_pages: { $sum: { $cond: [{ $eq: ['$ocr.model', TARGET] }, 1, 0] } },
    translated: { $sum: { $cond: [
      { $and: [
        { $ifNull: ['$translation.data', false] },
        { $ne: ['$translation.data', ''] }
      ]}, 1, 0
    ]}},
    models: { $addToSet: '$ocr.model' }
  }},
  { $sort: { old_model_pages: -1 } }
]).toArray();

// Book metadata
const bookIds = bookStats.map(b => b._id);
const books = await db.collection('books').find(
  { id: { $in: bookIds } },
  { projection: { id: 1, title: 1, display_title: 1, language: 1, original_language: 1, read_count: 1, pages_count: 1 } }
).toArray();
const bookMap = {};
books.forEach(b => { bookMap[b.id] = b; });

// Build CSV
let csv = 'book_id,title,language,read_count,pages_total,ocr_pages,old_model_pages,new_model_pages,translated_pages,needs_reocr,needs_retranslate,old_models,url\n';

let totalOldPages = 0;
let totalTranslated = 0;
let booksNeedReocr = 0;
let booksNeedRetranslate = 0;

for (const r of bookStats) {
  const b = bookMap[r._id] || {};
  const title = (b.display_title || b.title || '').replace(/,/g, ';').replace(/"/g, "'");
  const lang = b.original_language || b.language || '';
  const needsReocr = r.old_model_pages > 0;
  const needsRetranslate = r.translated > 0;

  if (needsReocr) { booksNeedReocr++; totalOldPages += r.old_model_pages; }
  if (needsRetranslate) { booksNeedRetranslate++; totalTranslated += r.translated; }

  const oldModels = r.models.filter(m => m !== null && m !== TARGET && !SKIP.includes(m));

  csv += [
    r._id,
    '"' + title + '"',
    lang,
    b.read_count || 0,
    b.pages_count || 0,
    r.total_ocr,
    r.old_model_pages,
    r.new_model_pages,
    r.translated,
    needsReocr ? 'yes' : 'no',
    needsRetranslate ? 'yes' : 'no',
    '"' + oldModels.join('; ') + '"',
    'https://sourcelibrary.org/book/' + r._id
  ].join(',') + '\n';
}

writeFileSync('reprocessing-needed.csv', csv);

console.log('=== Reprocessing Summary ===');
console.log('Total books with OCR:', bookStats.length);
console.log('Books needing re-OCR:', booksNeedReocr, `(${totalOldPages.toLocaleString()} pages)`);
console.log('Books needing re-translation:', booksNeedRetranslate, `(${totalTranslated.toLocaleString()} pages)`);
console.log('');
console.log('Estimated re-OCR cost (batch, 50% discount):', '$' + (totalOldPages * 0.00079).toFixed(2));
console.log('Estimated re-translate cost (batch):', '$' + (totalTranslated * 0.00079).toFixed(2));
console.log('Total estimated cost:', '$' + ((totalOldPages + totalTranslated) * 0.00079).toFixed(2));
console.log('');
console.log('CSV written: reprocessing-needed.csv');

await client.close();
