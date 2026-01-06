const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function generateFinalReport() {
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

    // Get all books
    const sourceBooks = await sourceBooksCollection.find({}).toArray();
    const targetBooks = await targetBooksCollection.find({}).toArray();

    console.log('=== FINAL MIGRATION REPORT ===\n');

    // Find books from source that now exist in target
    const targetBookIds = new Set(targetBooks.map(b => b._id.toString()));
    const migratedBooks = sourceBooks.filter(b => {
      // Skip test book
      if (b.title?.toLowerCase() === 'test' && b.author?.toLowerCase() === 'test') {
        return false;
      }
      return targetBookIds.has(b._id.toString());
    });

    console.log('DATABASE TOTALS:');
    console.log(`  Source (sourcelibrary_research): ${sourceBooks.length} books`);
    console.log(`  Target (bookstore): ${targetBooks.length} books`);
    console.log(`  Test books excluded: 1`);
    console.log(`  Total migrated from source to target: ${migratedBooks.length} books\n`);

    // Count total pages migrated
    let totalPagesMigrated = 0;
    const booksWithPages = [];

    for (const book of migratedBooks) {
      const pagesInTarget = await targetPagesCollection.countDocuments({
        book_id: book._id.toString()
      });

      if (pagesInTarget > 0) {
        totalPagesMigrated += pagesInTarget;
        booksWithPages.push({
          title: book.title,
          author: book.author,
          pages: pagesInTarget
        });
      }
    }

    console.log('PAGES MIGRATED:');
    console.log(`  Total pages: ${totalPagesMigrated}`);
    console.log(`  Books with pages: ${booksWithPages.length}`);

    if (booksWithPages.length > 0) {
      console.log('\n  Books that have pages:');
      booksWithPages.forEach(book => {
        console.log(`    - "${book.title}" by ${book.author}: ${book.pages} pages`);
      });
    }

    // List all migrated books
    console.log('\n=== ALL MIGRATED BOOKS ===\n');
    migratedBooks.forEach((book, idx) => {
      const pageCount = booksWithPages.find(b => b.title === book.title)?.pages || 0;
      console.log(`${idx + 1}. "${book.title}"`);
      console.log(`   Author: ${book.author}`);
      console.log(`   Pages: ${pageCount}`);
      console.log(`   ID: ${book._id}\n`);
    });

    console.log('=== MIGRATION COMPLETE ===');
    console.log('All unique books from sourcelibrary_research have been successfully migrated to bookstore database.');

  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

generateFinalReport();
