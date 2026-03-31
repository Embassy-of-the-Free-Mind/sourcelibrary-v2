#!/usr/bin/env node
/**
 * Suggest Vocabulary Snapshot
 *
 * Pre-computes the fuzzy-search vocabulary (titles, authors, index terms)
 * and stores it in system_config._id: 'suggest_vocabulary'.
 *
 * /api/search/suggest reads this single doc (<50ms) instead of scanning
 * the entire books collection on every cold Vercel invocation (12s+).
 *
 * Run: every 2 hours on Hetzner (alongside enrichment-snapshot).
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function tokenize(text) {
  return text
    .split(/[\s,;:]+/)
    .map(w => w.replace(/[^a-zA-ZÀ-ÿ\-']/g, ''))
    .filter(w => w.length >= 3);
}

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const start = Date.now();

  console.log(`[suggest-vocabulary] Starting at ${new Date().toISOString()}`);

  const books = await db.collection('books')
    .find(
      { visible: true, pages_count: { $gt: 0 } },
      { projection: { title: 1, display_title: 1, author: 1, 'index.concepts': 1, 'index.people': 1, 'index.places': 1, 'index.keyTerms': 1 }, maxTimeMS: 30000 },
    )
    .toArray();

  console.log(`  Loaded ${books.length} books`);

  const terms = new Set();

  for (const book of books) {
    // Full phrases only — findSuggestions does fuzzy matching on these.
    // Individual tokenized words bloat the doc (478K→~30K terms) without
    // improving suggestion quality.
    if (book.title) terms.add(book.title);
    if (book.display_title) terms.add(book.display_title);
    if (book.author) terms.add(book.author);

    const idx = book.index;
    if (!idx) continue;

    // Skip idx.vocabulary (109 terms/book, mostly noise for suggestions)
    for (const arr of [idx.concepts, idx.people, idx.places, idx.keyTerms].filter(Boolean)) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const name = typeof item === 'string' ? item : item?.term || item?.name;
        if (name && name.length >= 2) {
          terms.add(name);
        }
      }
    }
  }

  const vocabulary = Array.from(terms);
  console.log(`  Built vocabulary: ${vocabulary.length} terms`);

  await db.collection('system_config').updateOne(
    { _id: 'suggest_vocabulary' },
    {
      $set: {
        terms: vocabulary,
        book_count: books.length,
        term_count: vocabulary.length,
        updated_at: new Date(),
        duration_ms: Date.now() - start,
      },
    },
    { upsert: true },
  );

  console.log(`  Written to system_config in ${Date.now() - start}ms`);
  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
