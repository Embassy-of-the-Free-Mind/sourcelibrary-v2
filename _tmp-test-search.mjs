import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const query = 'test';
const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Test 1: searchBooks
console.log('--- Test 1: searchBooks ($text) ---');
try {
  const books = await db.collection('books')
    .find({ $text: { $search: query }, hidden: { $ne: true } }, {
      projection: { id: 1, title: 1, score: { $meta: 'textScore' } }
    })
    .sort({ score: { $meta: 'textScore' } })
    .limit(3)
    .toArray();
  console.log('OK:', books.length, 'results');
} catch (e) {
  console.error('FAILED:', e.message);
}

// Test 2: searchIndex
console.log('\n--- Test 2: searchIndex (aggregation) ---');
try {
  const results = await db.collection('books').aggregate([
    { $match: {
        'index.generatedAt': { $exists: true },
        hidden: { $ne: true },
        $or: [
          { 'index.concepts.term': queryRegex },
          { 'index.people.term': queryRegex },
          { 'index.places.term': queryRegex },
          { 'index.keywords.term': queryRegex }
        ]
      }
    },
    { $project: {
        id: 1,
        book_title: { $ifNull: ['$display_title', '$title'] },
        entries: { $concatArrays: [
          { $map: { input: { $ifNull: ['$index.concepts', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'concept' } } },
          { $map: { input: { $ifNull: ['$index.people', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'person' } } },
          { $map: { input: { $ifNull: ['$index.places', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'place' } } },
          { $map: { input: { $ifNull: ['$index.keywords', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'keyword' } } }
        ] }
      }
    },
    { $unwind: '$entries' },
    { $match: { 'entries.term': queryRegex } },
    { $limit: 5 }
  ], { maxTimeMS: 5000 }).toArray();
  console.log('OK:', results.length, 'results');
} catch (e) {
  console.error('FAILED:', e.message);
}

// Test 3: searchGallery
console.log('\n--- Test 3: searchGallery ---');
try {
  const images = await db.collection('gallery_images')
    .find({
      gallery_quality: { $gte: 0.5 },
      $or: [
        { description: queryRegex },
        { museum_description: queryRegex },
        { 'metadata.subjects': queryRegex },
        { 'metadata.figures': queryRegex },
      ],
    })
    .sort({ gallery_quality: -1 })
    .limit(3)
    .maxTimeMS(3000)
    .toArray();
  console.log('OK:', images.length, 'results');
} catch (e) {
  console.error('FAILED:', e.message);
}

await client.close();
