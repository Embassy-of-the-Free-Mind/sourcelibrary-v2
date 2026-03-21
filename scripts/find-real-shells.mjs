import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const issues = new Map();

// Find books with absolutely NO source information
const noSourceBooks = await books.find({
  hidden: { $ne: true },
  $and: [
    { source_url: { $exists: false } },
    { ia_id: { $exists: false } },
    { ia_identifier: { $exists: false } },
    { 'image_source.source_url': { $exists: false } },
    { 'dublin_core.dc_source': { $exists: false } }
  ]
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1,
  language: 1,
  pages_ocr: 1,
  pages_translated: 1
}).toArray();

console.log(`Found ${noSourceBooks.length} books with NO source info across all fields`);
for (const book of noSourceBooks) {
  issues.set(book.id, {
    title: book.title,
    slug: book.slug,
    pages_count: book.pages_count,
    pages_ocr: book.pages_ocr || 0,
    pages_translated: book.pages_translated || 0,
    issue: 'No source_url, ia_id, ia_identifier, image_source, or dublin_core',
    severity: 'critical'
  });
}

// Issue 2: Very few pages (1-3)
const tinyBooks = await books.find({
  hidden: { $ne: true },
  pages_count: { $gte: 1, $lte: 3 }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1,
  pages_ocr: 1,
  pages_translated: 1
}).toArray();

console.log(`Found ${tinyBooks.length} books with 1-3 pages`);
for (const book of tinyBooks) {
  if (!issues.has(book.id)) {
    issues.set(book.id, {
      title: book.title,
      slug: book.slug,
      pages_count: book.pages_count,
      pages_ocr: book.pages_ocr || 0,
      pages_translated: book.pages_translated || 0,
      issue: 'Very few pages (possible broken import)',
      severity: 'medium'
    });
  }
}

// Issue 1: pages_count > 0 but 0 pages with OCR (sample)
console.log(`Sampling 500 books with pages_count > 0 for OCR gaps...`);
const sampleBooks = await books.find({ 
  hidden: { $ne: true },
  pages_count: { $gt: 0 }
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1,
  pages_ocr: 1,
  pages_translated: 1
}).limit(500).toArray();

let noOcrCount = 0;
for (const book of sampleBooks) {
  const ocrCount = await pages.countDocuments({
    book_id: book.id,
    'ocr.data': { $exists: true, $ne: null }
  });
  if (ocrCount === 0 && book.pages_count > 0) {
    if (!issues.has(book.id)) {
      issues.set(book.id, {
        title: book.title,
        slug: book.slug,
        pages_count: book.pages_count,
        pages_ocr: book.pages_ocr || 0,
        pages_translated: book.pages_translated || 0,
        issue: 'No OCR pages despite pages_count > 0',
        severity: 'high'
      });
      noOcrCount++;
    }
  }
}

console.log(`Found ${noOcrCount} books with no OCR (from sample of 500)`);

// Sort and display top 10
const sorted = Array.from(issues.values()).sort((a, b) => {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  if (severityOrder[a.severity] !== severityOrder[b.severity]) {
    return severityOrder[a.severity] - severityOrder[b.severity];
  }
  return b.pages_count - a.pages_count;
});

console.log(`\n=== TOP 10 PROBLEMATIC BOOKS ===\n`);
sorted.slice(0, 10).forEach((issue, i) => {
  console.log(`${i + 1}. "${issue.title}"`);
  console.log(`   URL: https://sourcelibrary.org/book/${issue.slug}`);
  console.log(`   Pages: ${issue.pages_count} (OCR: ${issue.pages_ocr}, Translated: ${issue.pages_translated})`);
  console.log(`   Issue: ${issue.issue} [${issue.severity}]`);
  console.log('');
});

console.log(`=== SUMMARY ===`);
console.log(`Total unique issues: ${issues.size}`);
const bySeverity = Array.from(issues.values()).reduce((acc, i) => {
  acc[i.severity] = (acc[i.severity] || 0) + 1;
  return acc;
}, {});
console.log(`By severity:`, bySeverity);

await client.close();
