const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function verifyMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const sourceDb = client.db('sourcelibrary_research');
    const targetDb = client.db('bookstore');

    const sourceBooksCollection = sourceDb.collection('books');
    const targetBooksCollection = targetDb.collection('books');
    const sourcePagesCollection = sourceDb.collection('pages');
    const targetPagesCollection = targetDb.collection('pages');

    // Get all books from both databases
    const sourceBooks = await sourceBooksCollection.find({}).toArray();
    const targetBooks = await targetBooksCollection.find({}).toArray();

    console.log('=== DATABASE COMPARISON ===\n');
    console.log(`Source (sourcelibrary_research): ${sourceBooks.length} books`);
    console.log(`Target (bookstore): ${targetBooks.length} books`);

    // Check for books in source that exist in target by _id
    const targetBookIds = new Set(targetBooks.map(b => b._id.toString()));
    const migratedBooks = sourceBooks.filter(b => targetBookIds.has(b._id.toString()));

    console.log(`\nBooks from source that exist in target: ${migratedBooks.length}`);

    // Check for books in source that don't exist in target
    const notMigratedBooks = sourceBooks.filter(b => {
      // Skip test book
      if (b.title?.toLowerCase() === 'test' && b.author?.toLowerCase() === 'test') {
        return false;
      }
      return !targetBookIds.has(b._id.toString());
    });

    console.log(`Books from source NOT in target (excluding test): ${notMigratedBooks.length}`);

    if (notMigratedBooks.length > 0) {
      console.log('\nBooks not yet migrated:');
      notMigratedBooks.forEach((book, idx) => {
        console.log(`  ${idx + 1}. "${book.title}" by ${book.author}`);
      });
    }

    // Check pages for the book that has pages (Henrici Cor. Agrippae De occulta philosophia libri III)
    const agrippaBooksInSource = await sourceBooksCollection.find({
      title: 'Henrici Cor. Agrippae De occulta philosophia libri III'
    }).toArray();

    if (agrippaBooksInSource.length > 0) {
      const agrippaBook = agrippaBooksInSource[0];
      const sourcePagesForAgrippa = await sourcePagesCollection.find({
        book_id: agrippaBook._id.toString()
      }).toArray();

      const targetPagesForAgrippa = await targetPagesCollection.find({
        book_id: agrippaBook._id.toString()
      }).toArray();

      console.log(`\n=== PAGES CHECK (Agrippa book) ===`);
      console.log(`Source pages: ${sourcePagesForAgrippa.length}`);
      console.log(`Target pages: ${targetPagesForAgrippa.length}`);
    }

    console.log('\n=== VERIFICATION COMPLETE ===');

  } catch (error) {
    console.error('Error during verification:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

verifyMigration();
