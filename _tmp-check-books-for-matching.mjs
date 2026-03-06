import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // 1. Total count
  const totalCount = await books.countDocuments();
  console.log(`\n=== BOOK CATALOG STATS ===`);
  console.log(`Total books: ${totalCount}`);

  // 2. Sample 10 books
  const sample = await books.find({}, {
    projection: { _id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, published: 1, original_language: 1 }
  }).limit(10).toArray();

  console.log(`\n=== SAMPLE 10 BOOKS ===`);
  for (const b of sample) {
    console.log(JSON.stringify({
      _id: b._id,
      title: b.title?.substring(0, 80),
      display_title: b.display_title?.substring(0, 80),
      author: b.author?.substring(0, 60),
      year: b.year,
      published: b.published,
      language: b.language,
      original_language: b.original_language,
    }));
  }

  // 3. Counts of books with useful fields
  const withSummary = await books.countDocuments({ 'reading_summary.overview': { $exists: true, $ne: '' } });
  const withIndexBrief = await books.countDocuments({ 'index.bookSummary.brief': { $exists: true, $ne: '' } });
  const withIndex = await books.countDocuments({ 'index.generatedAt': { $exists: true } });

  console.log(`\n=== ENRICHMENT COVERAGE ===`);
  console.log(`Books with reading_summary.overview: ${withSummary} (${(withSummary/totalCount*100).toFixed(1)}%)`);
  console.log(`Books with index.bookSummary.brief: ${withIndexBrief} (${(withIndexBrief/totalCount*100).toFixed(1)}%)`);
  console.log(`Books with index (any): ${withIndex} (${(withIndex/totalCount*100).toFixed(1)}%)`);

  // 4. Title length stats + estimate catalog size
  const titleStats = await books.aggregate([
    { $project: {
      titleLen: { $strLenCP: { $ifNull: ['$title', ''] } },
      authorLen: { $strLenCP: { $ifNull: ['$author', ''] } },
      displayTitleLen: { $strLenCP: { $ifNull: ['$display_title', ''] } },
    }},
    { $group: {
      _id: null,
      avgTitleLen: { $avg: '$titleLen' },
      maxTitleLen: { $max: '$titleLen' },
      avgAuthorLen: { $avg: '$authorLen' },
      maxAuthorLen: { $max: '$authorLen' },
      avgDisplayTitleLen: { $avg: '$displayTitleLen' },
      maxDisplayTitleLen: { $max: '$displayTitleLen' },
    }}
  ]).toArray();

  const stats = titleStats[0];
  console.log(`\n=== FIELD LENGTH STATS ===`);
  console.log(`Avg title length: ${stats.avgTitleLen.toFixed(1)} chars (max: ${stats.maxTitleLen})`);
  console.log(`Avg display_title length: ${stats.avgDisplayTitleLen.toFixed(1)} chars (max: ${stats.maxDisplayTitleLen})`);
  console.log(`Avg author length: ${stats.avgAuthorLen.toFixed(1)} chars (max: ${stats.maxAuthorLen})`);

  // 5. Estimate compact catalog size
  // Format: "ID | Author | Title | Year | Language"
  // Rough estimate per book: ~120 chars
  const estPerBook = stats.avgTitleLen + stats.avgAuthorLen + 30; // +30 for ID, year, lang, delimiters
  const estTotalChars = estPerBook * totalCount;
  const estTokens = estTotalChars / 4; // rough chars-to-tokens ratio

  console.log(`\n=== CATALOG SIZE ESTIMATES ===`);
  console.log(`Est. chars per book entry: ~${Math.round(estPerBook)}`);
  console.log(`Est. total catalog size: ~${Math.round(estTotalChars / 1024)}KB (~${Math.round(estTotalChars)} chars)`);
  console.log(`Est. tokens (chars/4): ~${Math.round(estTokens).toLocaleString()}`);
  console.log(`Fits in 128k context? ${estTokens < 100000 ? 'YES' : 'NO (need chunking or embeddings)'}`);
  console.log(`Fits in 1M context? ${estTokens < 900000 ? 'YES' : 'NO'}`);

  // 6. Language distribution
  const langDist = await books.aggregate([
    { $group: { _id: { $ifNull: ['$language', '$original_language'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 }
  ]).toArray();

  console.log(`\n=== LANGUAGE DISTRIBUTION (top 15) ===`);
  for (const l of langDist) {
    console.log(`  ${l._id || 'null'}: ${l.count}`);
  }

  // 7. Year distribution
  const yearDist = await books.aggregate([
    { $match: { year: { $exists: true, $type: 'number' } } },
    { $bucket: {
      groupBy: '$year',
      boundaries: [0, 1400, 1500, 1550, 1600, 1650, 1700, 1750, 1800, 1900, 2100],
      default: 'other',
      output: { count: { $sum: 1 } }
    }}
  ]).toArray();

  console.log(`\n=== YEAR DISTRIBUTION ===`);
  for (const y of yearDist) {
    const label = y._id === 'other' ? 'other/unknown' : `${y._id}–`;
    console.log(`  ${label}: ${y.count}`);
  }

  // 8. What would a compact catalog entry look like?
  const allBooks = await books.find({}, {
    projection: { title: 1, display_title: 1, author: 1, year: 1, language: 1, original_language: 1, 'index.bookSummary.brief': 1 }
  }).toArray();

  // Build a minimal catalog and measure actual size
  let catalogLines = [];
  for (const b of allBooks) {
    const t = (b.display_title || b.title || '').substring(0, 100);
    const a = (b.author || '').substring(0, 60);
    const y = b.year || '';
    const lang = b.language || b.original_language || '';
    const brief = b.index?.bookSummary?.brief?.substring(0, 120) || '';
    const line = `${b._id} | ${a} | ${t} | ${y} | ${lang}${brief ? ' | ' + brief : ''}`;
    catalogLines.push(line);
  }

  const fullCatalog = catalogLines.join('\n');
  const actualChars = fullCatalog.length;
  const actualTokens = actualChars / 4;

  console.log(`\n=== ACTUAL CATALOG MEASUREMENT ===`);
  console.log(`Total lines: ${catalogLines.length}`);
  console.log(`Total chars: ${actualChars.toLocaleString()}`);
  console.log(`Est. tokens: ~${Math.round(actualTokens).toLocaleString()}`);
  console.log(`Fits in 128k context? ${actualTokens < 100000 ? 'YES' : 'Tight / NO'}`);
  console.log(`Fits in 1M context? ${actualTokens < 900000 ? 'YES' : 'NO'}`);

  // Show first 5 lines as examples
  console.log(`\n=== CATALOG SAMPLE (first 5 lines) ===`);
  for (let i = 0; i < 5; i++) {
    console.log(catalogLines[i]);
  }

  // With brief summaries
  const withBriefCount = catalogLines.filter(l => l.split('|').length > 5).length;
  console.log(`\nLines with brief summary: ${withBriefCount} / ${catalogLines.length}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
