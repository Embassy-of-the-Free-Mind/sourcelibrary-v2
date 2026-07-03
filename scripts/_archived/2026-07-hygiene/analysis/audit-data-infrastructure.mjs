#!/usr/bin/env node
/**
 * Audit data infrastructure for MCP server readiness.
 * Checks: index coverage, entity quality, metadata cleanliness, text availability.
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function run() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  const books = db.collection('books');
  const pages = db.collection('pages');
  const entities = db.collection('entities');

  // 1. Total books
  const totalBooks = await books.countDocuments({});
  console.log(`\n=== COLLECTION OVERVIEW ===`);
  console.log(`Total books: ${totalBooks}`);

  const totalPages = await pages.countDocuments({});
  console.log(`Total pages: ${totalPages}`);

  // 2. Index coverage
  const booksWithIndex = await books.countDocuments({ 'index.generatedAt': { $exists: true } });
  const booksWithSummary = await books.countDocuments({ 'reading_summary.generated_at': { $exists: true } });
  console.log(`\n=== AI INDEX & SUMMARY COVERAGE ===`);
  console.log(`Books with AI index: ${booksWithIndex} / ${totalBooks} (${(booksWithIndex/totalBooks*100).toFixed(1)}%)`);
  console.log(`Books with reading summary: ${booksWithSummary} / ${totalBooks} (${(booksWithSummary/totalBooks*100).toFixed(1)}%)`);

  // 3. Entity coverage
  const totalEntities = await entities.countDocuments({});
  const entitiesWithAliases = await entities.countDocuments({ 'aliases.0': { $exists: true } });
  const entitiesWithDescription = await entities.countDocuments({ description: { $exists: true, $ne: '' } });
  const entityTypes = await entities.aggregate([
    { $group: { _id: '$type', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log(`\n=== ENTITY KNOWLEDGE GRAPH ===`);
  console.log(`Total entities: ${totalEntities}`);
  console.log(`With aliases: ${entitiesWithAliases} (${totalEntities ? (entitiesWithAliases/totalEntities*100).toFixed(1) : 0}%)`);
  console.log(`With description: ${entitiesWithDescription} (${totalEntities ? (entitiesWithDescription/totalEntities*100).toFixed(1) : 0}%)`);
  console.log(`By type:`, entityTypes.map(t => `${t._id}: ${t.count}`).join(', '));

  // Average books per entity
  const entityBookStats = await entities.aggregate([
    { $project: { bookCount: { $size: { $ifNull: ['$books', []] } } } },
    { $group: { _id: null, avg: { $avg: '$bookCount' }, max: { $max: '$bookCount' }, moreThanOne: { $sum: { $cond: [{ $gt: ['$bookCount', 1] }, 1, 0] } } } }
  ]).toArray();
  if (entityBookStats.length) {
    const s = entityBookStats[0];
    console.log(`Avg books per entity: ${s.avg?.toFixed(1)}, max: ${s.max}, entities in 2+ books: ${s.moreThanOne}`);
  }

  // 4. OCR and translation coverage
  const pagesWithOcr = await pages.countDocuments({ 'ocr.data': { $exists: true, $ne: '' } });
  const pagesWithTranslation = await pages.countDocuments({ 'translation.data': { $exists: true, $ne: '' } });
  console.log(`\n=== PAGE TEXT COVERAGE ===`);
  console.log(`Pages with OCR: ${pagesWithOcr} / ${totalPages} (${(pagesWithOcr/totalPages*100).toFixed(1)}%)`);
  console.log(`Pages with translation: ${pagesWithTranslation} / ${totalPages} (${(pagesWithTranslation/totalPages*100).toFixed(1)}%)`);

  // 5. Language distribution
  const langDist = await books.aggregate([
    { $group: { _id: { $ifNull: ['$language', 'null'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log(`\n=== LANGUAGE DISTRIBUTION ===`);
  langDist.forEach(l => console.log(`  ${l._id}: ${l.count}`));

  // 6. Year/date quality
  const booksWithYear = await books.countDocuments({ year: { $exists: true, $type: 'number' } });
  const booksWithPublished = await books.countDocuments({ published: { $exists: true, $ne: '' } });
  const booksNoYear = await books.countDocuments({ $or: [{ year: { $exists: false } }, { year: null }] });
  console.log(`\n=== TEMPORAL METADATA ===`);
  console.log(`Books with numeric year: ${booksWithYear} / ${totalBooks} (${(booksWithYear/totalBooks*100).toFixed(1)}%)`);
  console.log(`Books with published field: ${booksWithPublished} / ${totalBooks}`);
  console.log(`Books missing year entirely: ${booksNoYear}`);

  // 7. Detected images / gallery
  const pagesWithImages = await pages.countDocuments({ 'detected_images.0': { $exists: true } });
  const totalDetectedImages = await pages.aggregate([
    { $match: { 'detected_images.0': { $exists: true } } },
    { $project: { count: { $size: '$detected_images' } } },
    { $group: { _id: null, total: { $sum: '$count' } } }
  ]).toArray();
  console.log(`\n=== GALLERY / IMAGE EXTRACTION ===`);
  console.log(`Pages with detected images: ${pagesWithImages}`);
  console.log(`Total detected images: ${totalDetectedImages[0]?.total || 0}`);

  // 8. Books that are "research ready" (have OCR + translation + index)
  // We need to check which books have substantial translated pages AND an index
  const researchReady = await books.aggregate([
    { $match: { 'index.generatedAt': { $exists: true }, 'reading_summary.generated_at': { $exists: true } } },
    { $lookup: { from: 'pages', localField: '_id', foreignField: 'book_id', pipeline: [
      { $match: { 'translation.data': { $exists: true, $ne: '' } } },
      { $count: 'n' }
    ], as: 'tp' } },
    { $addFields: { translatedPages: { $ifNull: [{ $arrayElemAt: ['$tp.n', 0] }, 0] } } },
    { $match: { translatedPages: { $gte: 10 } } },
    { $count: 'total' }
  ]).toArray();
  console.log(`\n=== RESEARCH READINESS ===`);
  console.log(`Books with index + summary + 10+ translated pages: ${researchReady[0]?.total || 0}`);

  // 9. Check for duplicate entities (same name, different records)
  const dupeNames = await entities.aggregate([
    { $group: { _id: { $toLower: '$name' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]).toArray();
  console.log(`\n=== ENTITY DEDUP ===`);
  console.log(`Entity names appearing more than once: ${dupeNames.length}`);
  if (dupeNames.length) {
    dupeNames.slice(0, 5).forEach(d => console.log(`  "${d._id}" — ${d.count} records`));
  }

  // 10. Source/provider distribution
  const providerDist = await books.aggregate([
    { $group: { _id: { $ifNull: ['$image_source.provider', 'unknown'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log(`\n=== SOURCE PROVIDERS ===`);
  providerDist.forEach(p => console.log(`  ${p._id}: ${p.count}`));

  await client.close();
  console.log(`\n--- Audit complete ---`);
}

run().catch(e => { console.error(e); process.exit(1); });
