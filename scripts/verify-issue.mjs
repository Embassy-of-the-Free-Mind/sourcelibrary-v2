import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

const total = await books.countDocuments({ hidden: { $ne: true } });
const withSource = await books.countDocuments({ 
  hidden: { $ne: true }, 
  $or: [
    { source_url: { $exists: true } },
    { ia_id: { $exists: true } }
  ]
});
const noSource = await books.countDocuments({
  hidden: { $ne: true },
  source_url: { $exists: false },
  ia_id: { $exists: false }
});

console.log('Total non-hidden books:', total);
console.log('With source_url or ia_id:', withSource);
console.log('Without both:', noSource);
console.log('Percentage without source:', ((noSource / total) * 100).toFixed(1) + '%');

// Sample a few to see what they look like
const samples = await books.find({
  hidden: { $ne: true },
  source_url: { $exists: false },
  ia_id: { $exists: false }
}).project({
  title: 1,
  pages_count: 1,
  language: 1,
  creator: 1,
  description: 1
}).limit(3).toArray();

console.log('\n=== SAMPLE BOOKS ===');
for (const book of samples) {
  console.log('\n---');
  console.log('Title:', book.title);
  console.log('Pages:', book.pages_count);
  console.log('Language:', book.language);
  console.log('Creator:', book.creator);
  console.log('Description length:', book.description?.length || 0);
}

await client.close();
