const { MongoClient } = require('mongodb');
const fs = require('fs');

// Load .env.local
const content = fs.readFileSync('.env.local', 'utf8');
content.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2];
  }
});

const BOOK_ID = '69482b01914d007380634f38';

async function deleteBook() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();

    // Find the book first
    const book = await db.collection('books').findOne({ id: BOOK_ID });
    if (book) {
      console.log('Found book:', book.title || book.display_title);
      console.log('Author:', book.author);

      // Delete pages first
      const pagesResult = await db.collection('pages').deleteMany({ book_id: BOOK_ID });
      console.log('Deleted', pagesResult.deletedCount, 'pages');

      // Delete book
      const bookResult = await db.collection('books').deleteOne({ id: BOOK_ID });
      console.log('Deleted book:', bookResult.deletedCount > 0 ? 'success' : 'not found');
    } else {
      console.log('Book not found with ID:', BOOK_ID);
    }

    // List all books and check for duplicates
    console.log('\n--- All Books ---');
    const allBooks = await db.collection('books').find({}).project({ id: 1, title: 1, display_title: 1, author: 1 }).toArray();

    allBooks.forEach((b, i) => {
      const title = b.display_title || b.title;
      const author = b.author || 'Unknown';
      console.log((i+1) + '. ' + title + ' by ' + author);
      console.log('   ID: ' + b.id);
    });

    // Group by title to find duplicates
    console.log('\n--- Duplicates Check ---');
    const byTitle = {};
    allBooks.forEach(b => {
      const key = (b.display_title || b.title || '').toLowerCase().trim();
      if (!byTitle[key]) byTitle[key] = [];
      byTitle[key].push(b);
    });

    let hasDupes = false;
    for (const [title, books] of Object.entries(byTitle)) {
      if (books.length > 1 && title) {
        hasDupes = true;
        console.log('\nDuplicate: "' + title + '"');
        books.forEach(b => console.log('  - ID: ' + b.id));
      }
    }
    if (!hasDupes) console.log('No duplicates found');

  } finally {
    await client.close();
  }
}

deleteBook().catch(console.error);
