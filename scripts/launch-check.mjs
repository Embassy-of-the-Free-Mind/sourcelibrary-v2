import { MongoClient } from 'mongodb';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// 1. Books by pipeline status (visible only)
console.log('=== PIPELINE STATUS (visible books) ===');
const pipeline = await db.collection('books').aggregate([
  { $match: { hidden: { $ne: true }, 'pipeline_auto.status': { $exists: true } } },
  { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();
for (const p of pipeline) console.log(`  ${p._id}: ${p.count}`);

// 2. "Complete" books - fully processed
const completeBooks = await db.collection('books').countDocuments({ 
  hidden: { $ne: true }, 
  'pipeline_auto.status': 'complete' 
});
console.log(`\nFully complete books: ${completeBooks}`);

// 3. Books with reading_summary
const withSummary = await db.collection('books').countDocuments({
  hidden: { $ne: true },
  'reading_summary': { $exists: true }
});
console.log(`Books with reading_summary: ${withSummary}`);

// 4. Books with index
const withIndex = await db.collection('books').countDocuments({
  hidden: { $ne: true },
  'index.generatedAt': { $exists: true }
});
console.log(`Books with AI index: ${withIndex}`);

// 5. Books with chapters
const withChapters = await db.collection('books').countDocuments({
  hidden: { $ne: true },
  'chapters': { $exists: true, $ne: [] }
});
console.log(`Books with chapters: ${withChapters}`);

// 6. Total visible books
const totalVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
console.log(`Total visible books: ${totalVisible}`);

// 7. Books with >80% OCR coverage
const highOcr = await db.collection('books').aggregate([
  { $match: { hidden: { $ne: true }, pages_count: { $gt: 0 } } },
  { $addFields: { ocr_pct: { $divide: ['$pages_ocr', '$pages_count'] } } },
  { $facet: {
    over80: [{ $match: { ocr_pct: { $gte: 0.8 } } }, { $count: 'n' }],
    over50: [{ $match: { ocr_pct: { $gte: 0.5 } } }, { $count: 'n' }],
    under10: [{ $match: { ocr_pct: { $lt: 0.1 } } }, { $count: 'n' }],
    zero: [{ $match: { pages_ocr: 0 } }, { $count: 'n' }]
  }}
]).toArray();
const r = highOcr[0];
console.log(`\n=== OCR COVERAGE ===`);
console.log(`Books >80% OCR: ${r.over80[0]?.n || 0}`);
console.log(`Books >50% OCR: ${r.over50[0]?.n || 0}`);
console.log(`Books <10% OCR: ${r.under10[0]?.n || 0}`);
console.log(`Books 0% OCR: ${r.zero[0]?.n || 0}`);

// 8. Books with >80% translation
const highTrans = await db.collection('books').aggregate([
  { $match: { hidden: { $ne: true }, pages_count: { $gt: 0 } } },
  { $addFields: { trans_pct: { $divide: ['$pages_translated', '$pages_count'] } } },
  { $facet: {
    over80: [{ $match: { trans_pct: { $gte: 0.8 } } }, { $count: 'n' }],
    over50: [{ $match: { trans_pct: { $gte: 0.5 } } }, { $count: 'n' }],
    zero: [{ $match: { pages_translated: 0 } }, { $count: 'n' }]
  }}
]).toArray();
const t = highTrans[0];
console.log(`\n=== TRANSLATION COVERAGE ===`);
console.log(`Books >80% translated: ${t.over80[0]?.n || 0}`);
console.log(`Books >50% translated: ${t.over50[0]?.n || 0}`);
console.log(`Books 0% translated: ${t.zero[0]?.n || 0}`);

// 9. Language distribution
console.log(`\n=== LANGUAGE DISTRIBUTION ===`);
const langs = await db.collection('books').aggregate([
  { $match: { hidden: { $ne: true } } },
  { $group: { _id: '$language', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 15 }
]).toArray();
for (const l of langs) console.log(`  ${l._id || 'Unknown'}: ${l.count}`);

// 10. Gallery images
const galleryImages = await db.collection('gallery_images').countDocuments({});
console.log(`\nGallery images: ${galleryImages}`);

// 11. Entities
const entities = await db.collection('entities').countDocuments({});
const entitiesWithDesc = await db.collection('entities').countDocuments({ description: { $exists: true, $ne: '' } });
console.log(`Entities: ${entities} (${entitiesWithDesc} with descriptions)`);

// 12. Editions with DOIs
const editions = await db.collection('editions').countDocuments({ status: 'published' });
console.log(`Published editions: ${editions}`);

// 13. Check launch_curation field
const launchCurated = await db.collection('books').countDocuments({ launch_curation: true, hidden: { $ne: true } });
console.log(`Launch-curated books: ${launchCurated}`);

// 14. Books with archived images (Vercel Blob)
const booksWithArchive = await db.collection('books').aggregate([
  { $match: { hidden: { $ne: true } } },
  { $lookup: {
    from: 'pages',
    let: { bid: '$id' },
    pipeline: [
      { $match: { $expr: { $eq: ['$book_id', '$$bid'] }, archived_photo: { $exists: true, $ne: null } } },
      { $limit: 1 }
    ],
    as: 'archived'
  }},
  { $match: { 'archived.0': { $exists: true } } },
  { $count: 'n' }
]).toArray();
console.log(`Books with archived images: ${booksWithArchive[0]?.n || 0}`);

await c.close();
