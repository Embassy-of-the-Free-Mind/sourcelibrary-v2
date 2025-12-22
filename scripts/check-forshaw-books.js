const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    });
  }
}
loadEnv();

async function check() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri || !dbName) {
    console.error('Missing MONGODB_URI or MONGODB_DB in .env.local');
    process.exit(1);
  }

  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);

  console.log('=== FORSHAW BOOKS IN MONGODB ===\n');

  const books = await db.collection('books').find({ categories: 'Forshaw' }).toArray();

  if (books.length === 0) {
    console.log('No Forshaw books found. Checking all books...');
    const allBooks = await db.collection('books').find({}).toArray();
    console.log(`Total books in database: ${allBooks.length}`);
    allBooks.slice(0, 5).forEach(b => {
      console.log(`- ${b.title} (${b.author})`);
    });
  } else {
    for (const book of books) {
      const pageCount = await db.collection('pages').countDocuments({ book_id: book._id.toString() });
      console.log(`${book.title}`);
      console.log(`  Author: ${book.author}`);
      console.log(`  Language: ${book.language}`);
      console.log(`  Pages in DB: ${pageCount}`);
      console.log(`  ID: ${book._id}`);
      console.log('');
    }
  }

  await client.close();
}

check().catch(console.error);
