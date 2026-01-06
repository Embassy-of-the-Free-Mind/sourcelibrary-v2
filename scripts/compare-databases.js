const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function compareDatabases() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env.local');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const researchDb = client.db('sourcelibrary_research');
    const prodDb = client.db('bookstore');

    // Get all books from sourcelibrary_research
    console.log('Fetching books from sourcelibrary_research...');
    const researchBooks = await researchDb.collection('books').find({}).toArray();
    console.log(`Found ${researchBooks.length} books in sourcelibrary_research\n`);

    // Get all books from bookstore
    console.log('Fetching books from bookstore...');
    const prodBooks = await prodDb.collection('books').find({}).toArray();
    console.log(`Found ${prodBooks.length} books in bookstore\n`);

    // Create lookup maps for faster comparison
    const prodBooksById = new Map(prodBooks.map(b => [b._id.toString(), b]));
    const prodBooksByTitle = new Map(prodBooks.map(b => [b.title?.toLowerCase().trim(), b]));

    // Compare books
    const duplicates = [];
    const uniqueToResearch = [];

    for (const researchBook of researchBooks) {
      const researchId = researchBook._id.toString();
      const researchTitle = researchBook.title?.toLowerCase().trim();

      // Check for match by ID
      const matchById = prodBooksById.has(researchId);

      // Check for match by title
      const matchByTitle = researchTitle && prodBooksByTitle.has(researchTitle);

      if (matchById || matchByTitle) {
        duplicates.push({
          id: researchId,
          title: researchBook.title,
          matchType: matchById ? 'ID' : 'Title'
        });
      } else {
        uniqueToResearch.push({
          id: researchId,
          title: researchBook.title,
          author: researchBook.author,
          year: researchBook.year
        });
      }
    }

    // Report findings
    console.log('='.repeat(80));
    console.log('COMPARISON RESULTS');
    console.log('='.repeat(80));
    console.log(`\nTotal books in sourcelibrary_research: ${researchBooks.length}`);
    console.log(`Total books in bookstore: ${prodBooks.length}`);
    console.log(`\nDuplicates (exist in both databases): ${duplicates.length}`);
    console.log(`Unique to sourcelibrary_research: ${uniqueToResearch.length}`);

    if (duplicates.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('DUPLICATES (first 20):');
      console.log('-'.repeat(80));
      duplicates.slice(0, 20).forEach((book, idx) => {
        console.log(`${idx + 1}. [${book.matchType}] ${book.title} (${book.id})`);
      });
      if (duplicates.length > 20) {
        console.log(`... and ${duplicates.length - 20} more`);
      }
    }

    if (uniqueToResearch.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('UNIQUE TO SOURCELIBRARY_RESEARCH:');
      console.log('-'.repeat(80));
      uniqueToResearch.forEach((book, idx) => {
        console.log(`${idx + 1}. ${book.title} by ${book.author || 'Unknown'} (${book.year || 'N/A'})`);
        console.log(`   ID: ${book.id}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('RECOMMENDATION');
    console.log('='.repeat(80));

    if (uniqueToResearch.length === 0) {
      console.log('\n✓ SAFE TO DELETE: All books in sourcelibrary_research exist in bookstore');
    } else {
      console.log(`\n⚠ WARNING: ${uniqueToResearch.length} book(s) in sourcelibrary_research do NOT exist in bookstore`);
      console.log('Review the unique books above before deleting sourcelibrary_research database');
    }
    console.log('');

  } catch (error) {
    console.error('Error comparing databases:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Connection closed');
  }
}

compareDatabases();
