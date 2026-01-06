const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function migrateUniqueBooks() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const sourceDb = client.db('sourcelibrary_research');
    const targetDb = client.db('bookstore');

    const sourceBooksCollection = sourceDb.collection('books');
    const targetBooksCollection = targetDb.collection('books');
    const sourcePagesCollection = sourceDb.collection('pages');
    const targetPagesCollection = targetDb.collection('pages');

    // Get all books from source
    const sourceBooks = await sourceBooksCollection.find({}).toArray();
    console.log(`Found ${sourceBooks.length} books in sourcelibrary_research`);

    // Get all books from target
    const targetBooks = await targetBooksCollection.find({}).toArray();
    console.log(`Found ${targetBooks.length} books in bookstore`);

    // Create a set of existing titles and IDs in target
    const existingTitles = new Set(
      targetBooks.map(book => book.title?.toLowerCase().trim())
    );
    const existingIds = new Set(
      targetBooks.map(book => book._id.toString())
    );

    // Find unique books that don't exist in target
    const uniqueBooks = sourceBooks.filter(book => {
      const normalizedTitle = book.title?.toLowerCase().trim();

      // Skip the "test" book by "test" author
      if (book.title?.toLowerCase() === 'test' && book.author?.toLowerCase() === 'test') {
        console.log(`Skipping test book: ${book.title}`);
        return false;
      }

      // Skip if book already exists by ID (already migrated)
      if (existingIds.has(book._id.toString())) {
        console.log(`Skipping already migrated book: ${book.title}`);
        return false;
      }

      return !existingTitles.has(normalizedTitle);
    });

    console.log(`\nFound ${uniqueBooks.length} unique books to migrate`);

    let booksInserted = 0;
    let pagesInserted = 0;
    const errors = [];

    // Migrate each unique book
    for (const book of uniqueBooks) {
      try {
        console.log(`\nMigrating book: "${book.title}" by ${book.author}`);

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
    console.log(`Books migrated: ${booksInserted} / ${uniqueBooks.length}`);
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
    console.log('Connection closed');
  }
}

migrateUniqueBooks();
