import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const issues = new Map();

// Issue 3: No source_url and no ia_id (metadata shells) - fast query
console.log('Checking Issue 3: No source_url and no ia_id...');
const noSource = await books.find({
  hidden: { $ne: true },
  source_url: { $exists: false },
  ia_id: { $exists: false }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1
}).limit(100).toArray();

for (const book of noSource) {
  issues.set(book.id, {
    title: book.title,
    slug: book.slug,
    pages_count: book.pages_count,
    issue: 'No source_url and no ia_id (metadata shell)',
    severity: 'high'
  });
}

console.log(`Found ${noSource.length} metadata shells`);

// Issue 2: Very few pages (1-3)
console.log('Checking Issue 2: Very few pages (1-3)...');
const tinyBooks = await books.find({
  hidden: { $ne: true },
  pages_count: { $gte: 1, $lte: 3 }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1
}).limit(100).toArray();

for (const book of tinyBooks) {
  if (!issues.has(book.id)) {
    issues.set(book.id, {
      title: book.title,
      slug: book.slug,
      pages_count: book.pages_count,
      issue: 'Very few pages (possible broken import)',
      severity: 'medium'
    });
  }
}

console.log(`Found ${tinyBooks.length} books with 1-3 pages`);

// Issue 1: pages_count > 0 but 0 pages with OCR - sample first 500 books
console.log('Checking Issue 1: pages_count > 0 but 0 OCR pages (sampling)...');
const sampleBooks = await books.find({ 
  hidden: { $ne: true },
  pages_count: { $gt: 0 }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1
}).limit(500).toArray();

let noOcrCount = 0;
for (const book of sampleBooks) {
  const ocrCount = await pages.countDocuments({
    book_id: book.id,
    'ocr.data': { $exists: true, $ne: null }
  });
  if (ocrCount === 0) {
    if (!issues.has(book.id)) {
      issues.set(book.id, {
        title: book.title,
        slug: book.slug,
        pages_count: book.pages_count,
        issue: 'No OCR pages despite pages_count > 0',
        severity: 'high'
      });
      noOcrCount++;
    }
  }
}

console.log(`Found ${noOcrCount} books with no OCR (from sample of 500)`);

// Sort and display
const sorted = Array.from(issues.values()).sort((a, b) => {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  if (severityOrder[a.severity] !== severityOrder[b.severity]) {
    return severityOrder[a.severity] - severityOrder[b.severity];
  }
  return b.pages_count - a.pages_count;
});

console.log(`\n=== TOP 10 ISSUES ===\n`);
sorted.slice(0, 10).forEach((issue, i) => {
  console.log(`${i + 1}. ${issue.title}`);
  console.log(`   Slug: ${issue.slug}`);
  console.log(`   Pages: ${issue.pages_count}`);
  console.log(`   Issue: ${issue.issue} [${issue.severity}]`);
  console.log('');
});

console.log(`Total unique issues found: ${issues.size}`);
await client.close();
