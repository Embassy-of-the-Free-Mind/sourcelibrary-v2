#!/usr/bin/env node
/**
 * Extract book-level features for clustering analysis.
 * Pulls title, author, year, language, summary, themes, and top index terms.
 * Outputs to scripts/output/book-features.json
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Querying books...');
  // Use aggregation to extract only top 30 index entries (avoid OOM from full index)
  const books = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true } } },
    {
      $project: {
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        language: 1,
        published: 1,
        year: 1,
        publisher: 1,
        categories: 1,
        collections: 1,
        'summary.data': 1,
        'reading_summary.themes': 1,
        pages_count: 1,
        pages_translated: 1,
        // Only pull top 30 index entries by slicing
        top_entries: {
          $slice: [
            { $sortArray: { input: { $ifNull: ['$index.entries', []] }, sortBy: { 'pages': -1 } } },
            30
          ]
        },
      }
    }
  ], { allowDiskUse: true }).toArray();

  console.log(`Found ${books.length} non-hidden books`);

  const features = books.map(book => {
    // Extract summary text
    let summaryText = book.summary?.data || '';

    // Extract themes
    const themes = book.reading_summary?.themes || [];

    // Extract top index terms (already sliced to 30 in aggregation)
    let topTerms = [];
    if (book.top_entries?.length) {
      topTerms = book.top_entries.map(e => e.term).filter(Boolean);
    }

    // Derive year from various fields
    let year = book.year;
    if (!year && book.published) {
      const match = book.published.match(/\d{4}/);
      if (match) year = parseInt(match[0]);
    }

    return {
      id: book.id || book._id?.toString(),
      title: book.display_title || book.title || '',
      author: book.author || '',
      language: book.language || '',
      year: year || null,
      publisher: book.publisher || '',
      pages_count: book.pages_count || 0,
      pages_translated: book.pages_translated || 0,
      categories: book.categories || [],
      collections: book.collections || [],
      summary: summaryText,
      themes: themes,
      top_terms: topTerms,
    };
  });

  // Stats
  const withSummary = features.filter(f => f.summary.length > 50).length;
  const withThemes = features.filter(f => f.themes.length > 0).length;
  const withTerms = features.filter(f => f.top_terms.length > 0).length;
  const withYear = features.filter(f => f.year).length;

  console.log(`\nCoverage:`);
  console.log(`  Summary (>50 chars): ${withSummary} / ${features.length} (${(withSummary/features.length*100).toFixed(1)}%)`);
  console.log(`  Themes:              ${withThemes} / ${features.length} (${(withThemes/features.length*100).toFixed(1)}%)`);
  console.log(`  Index terms:         ${withTerms} / ${features.length} (${(withTerms/features.length*100).toFixed(1)}%)`);
  console.log(`  Year:                ${withYear} / ${features.length} (${(withYear/features.length*100).toFixed(1)}%)`);

  const outPath = path.join(import.meta.dirname, '..', 'output', 'book-features.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(features, null, 2));
  console.log(`\nWrote ${features.length} books to ${outPath}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
