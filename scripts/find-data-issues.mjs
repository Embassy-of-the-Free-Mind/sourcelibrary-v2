import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const issues = [];

// Issue 1: pages_count > 0 but 0 pages with OCR
console.log('Checking Issue 1: pages_count > 0 but 0 OCR pages...');
const allBooks = await books.find({ hidden: { $ne: true } }).toArray();

for (const book of allBooks) {
  if (book.pages_count > 0) {
    const ocrCount = await pages.countDocuments({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: null }
    });
    if (ocrCount === 0) {
      issues.push({
        title: book.title,
        slug: book.slug,
        pages_count: book.pages_count,
        issue: 'No OCR pages despite pages_count > 0',
        severity: 'high'
      });
    }
  }
}

// Issue 2: Very few pages (1-3)
console.log('Checking Issue 2: Very few pages (1-3)...');
const tinyBooks = await books.find({
  hidden: { $ne: true },
  pages_count: { $gte: 1, $lte: 3 }
}).toArray();

for (const book of tinyBooks) {
  issues.push({
    title: book.title,
    slug: book.slug,
    pages_count: book.pages_count,
    issue: 'Very few pages (possible broken import)',
    severity: 'medium'
  });
}

// Issue 3: No source_url and no ia_id (metadata shells)
console.log('Checking Issue 3: No source_url and no ia_id...');
const noSource = await books.find({
  hidden: { $ne: true },
  source_url: { $exists: false },
  ia_id: { $exists: false }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1
}).toArray();

for (const book of noSource) {
  issues.push({
    title: book.title,
    slug: book.slug,
    pages_count: book.pages_count,
    issue: 'No source_url and no ia_id (metadata shell)',
    severity: 'high'
  });
}

// Combine and sort by severity + pages_count
issues.sort((a, b) => {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  if (severityOrder[a.severity] !== severityOrder[b.severity]) {
    return severityOrder[a.severity] - severityOrder[b.severity];
  }
  return b.pages_count - a.pages_count;
});

console.log(`\n=== RESULTS (Top 10) ===\n`);
issues.slice(0, 10).forEach((issue, i) => {
  console.log(`${i + 1}. ${issue.title}`);
  console.log(`   Slug: ${issue.slug}`);
  console.log(`   Pages: ${issue.pages_count}`);
  console.log(`   Issue: ${issue.issue} [${issue.severity}]`);
  console.log('');
});

console.log(`Total issues found: ${issues.length}`);
await client.close();
