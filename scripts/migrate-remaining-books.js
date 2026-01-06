const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function migrateRemainingBooks() {
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

    console.log('Source books:', sourceBooks.length);
    console.log('Target books:', targetBooks.length);

    // Find books in source that don't exist in target by _id
    const targetBookIds = new Set(targetBooks.map(b => b._id.toString()));
    const booksToMigrate = sourceBooks.filter(b => {
      // Skip test book
      if (b.title?.toLowerCase() === 'test' && b.author?.toLowerCase() === 'test') {
        return false;
      }
      return !targetBookIds.has(b._id.toString());
    });

    console.log(`\nFound ${booksToMigrate.length} books to migrate\n`);

    let booksInserted = 0;
    let pagesInserted = 0;
    const errors = [];

    // Migrate each book
    for (const book of booksToMigrate) {
      try {
        console.log(`Migrating: "${book.title}" by ${book.author}`);

        // Insert the book into target database
        const bookResult = await targetBooksCollection.insertOne(book);
        booksInserted++;
        console.log(`  - Book inserted with ID: ${bookResult.insertedId}`);

        // Find all pages for this book
        const pages = await sourcePagesCollection.find({
          book_id: book._id.toString()
        }).toArray();

        console.log(`  - Found ${pages.length} pages for this book`);

        if (pages.length > 0) {
          // Insert all pages into target database
          const pagesResult = await targetPagesCollection.insertMany(pages);
          pagesInserted += pagesResult.insertedCount;
          console.log(`  - Inserted ${pagesResult.insertedCount} pages`);
        }

      } catch (error) {
        console.error(`  - Error migrating book "${book.title}": ${error.message}`);
        errors.push({
          book: book.title,
          error: error.message
        });
      }
    }

    // Print summary report
    console.log('\n=== MIGRATION SUMMARY ===');
    console.log(`Books migrated: ${booksInserted} / ${booksToMigrate.length}`);
    console.log(`Pages migrated: ${pagesInserted}`);

    if (errors.length > 0) {
      console.log(`\nErrors encountered: ${errors.length}`);
      errors.forEach(err => {
        console.log(`  - ${err.book}: ${err.error}`);
      });
    } else {
      console.log('\nNo errors encountered');
    }

    console.log('\nMigration complete!');

  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrateRemainingBooks();
