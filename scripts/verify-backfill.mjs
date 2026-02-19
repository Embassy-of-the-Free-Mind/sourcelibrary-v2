import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const total = await books.countDocuments({});
const withYear = await books.countDocuments({ year: { $exists: true, $type: 'number' } });
const unknownLang = await books.countDocuments({
  $or: [
    { language: 'Unknown' },
    { language: { $exists: false } },
    { language: null },
    { language: '' }
  ]
});

const langs = await books.aggregate([
  { $group: { _id: '$language', count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 20 }
]).toArray();

console.log('=== POST-BACKFILL STATUS ===');
console.log(`Books with numeric year: ${withYear} / ${total} (${(withYear/total*100).toFixed(1)}%)`);
console.log(`Books with Unknown/missing language: ${unknownLang}`);
console.log('\nTop 20 languages:');
langs.forEach(l => console.log(`  ${l._id}: ${l.count}`));

await client.close();
