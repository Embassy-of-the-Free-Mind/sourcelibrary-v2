#!/usr/bin/env node
/**
 * Backfill related_books for all books using the entity graph.
 *
 * For each book:
 *   1. Find person entities mentioned in the book
 *   2. Check if those people authored other books in our library (direct citations)
 *   3. Find books sharing 5+ entity mentions (shared context)
 *   4. Store results in book.related_books
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/backfill-related-books.mjs
 *
 *   Options:
 *     --dry-run     Show what would be written without updating DB
 *     --limit N     Process only N books
 *     --book-id ID  Process a single book
 */

import { MongoClient } from 'mongodb';

const UBIQUITOUS_ENTITIES = new Set([
  'Jesus Christ', 'God', 'The Devil', 'Satan', 'Lucifer',
  'Moses', 'Abraham', 'Adam', 'Eve', 'Noah', 'David',
  'Hermes Trismegistus', 'Hermes', 'Mercury',
  'Aristotle', 'Plato', 'Socrates',
  'The Holy Spirit', 'The Son of God', 'The Apostles',
  'The Patriarchs', 'The Prophets',
]);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const bookIdIdx = args.indexOf('--book-id');
  const singleBookId = bookIdIdx >= 0 ? args[bookIdIdx + 1] : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Limit: ${limit === Infinity ? 'all' : limit}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const entitiesCol = db.collection('entities');

  // Pre-build author lookup: author name → [{ id, slug, title, author, published }]
  console.log('Building author index...');
  const allBooks = await booksCol.find(
    { hidden: { $ne: true } },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1 } }
  ).toArray();
  console.log(`  ${allBooks.length} visible books`);

  // Build index of author surnames → book docs
  const authorIndex = new Map(); // lowercase surname → [bookDoc]
  for (const book of allBooks) {
    const author = (book.author || '').trim();
    if (!author || author === 'Unknown' || author === 'Anonymous') continue;
    // Extract surname(s) for matching
    const surnames = extractSurnames(author);
    for (const s of surnames) {
      if (!authorIndex.has(s)) authorIndex.set(s, []);
      authorIndex.get(s).push(book);
    }
  }

  // Determine which books to process
  const filter = singleBookId
    ? { $or: [{ id: singleBookId }, { _id: singleBookId }] }
    : { hidden: { $ne: true } };

  const cursor = booksCol.find(filter, {
    projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1 }
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for await (const book of cursor) {
    if (processed >= limit) break;
    processed++;

    const bookId = book.id || book._id?.toString();
    if (!bookId) continue;

    try {
      // Step 1: Find person entities mentioned in this book
      const personEntities = await entitiesCol.find(
        { type: 'person', 'books.book_id': bookId },
        { projection: { name: 1, aliases: 1 } }
      ).toArray();

      if (personEntities.length === 0) {
        skipped++;
        if (processed % 500 === 0) console.log(`  ${processed} processed, ${updated} updated, ${skipped} skipped (no entities)`);
        continue;
      }

      // Step 2: Find direct citations — entities who authored other books
      const directMap = new Map(); // target bookId → cited_as
      const bookAuthorSurname = extractSurnames(book.author || '')[0] || '';

      for (const entity of personEntities) {
        if (UBIQUITOUS_ENTITIES.has(entity.name)) continue;

        const names = [entity.name, ...(entity.aliases || [])].filter(
          n => n && (n.includes(' ') ? n.length >= 4 : n.length >= 10)
        );

        for (const name of names) {
          const nameLower = name.toLowerCase();
          // Check author index for matches
          const nameParts = nameLower.split(/\s+/);
          for (const part of nameParts) {
            if (part.length < 4) continue;
            const candidates = authorIndex.get(part) || [];
            for (const candidate of candidates) {
              if ((candidate.id || candidate._id?.toString()) === bookId) continue;
              if (directMap.has(candidate.id)) continue;

              // Verify the full name matches
              const candidateAuthor = (candidate.author || '').toLowerCase();
              if (candidateAuthor.includes(nameLower) || nameLower.includes(candidateAuthor.split(',')[0].trim())) {
                // Exclude same-author books
                if (bookAuthorSurname && candidateAuthor.includes(bookAuthorSurname)) continue;
                directMap.set(candidate.id, entity.name);
              }
            }
          }
        }
      }

      // Dedupe: max 1 book per cited entity
      const seenEntities = new Set();
      const directBooks = [];
      for (const [targetId, citedAs] of directMap) {
        if (seenEntities.has(citedAs)) continue;
        seenEntities.add(citedAs);
        const targetBook = allBooks.find(b => (b.id || b._id?.toString()) === targetId);
        if (!targetBook) continue;
        directBooks.push({
          id: targetId,
          slug: targetBook.slug,
          title: targetBook.display_title || targetBook.title,
          author: targetBook.author || 'Unknown',
          published: targetBook.published,
          cited_as: citedAs,
        });
        if (directBooks.length >= 6) break;
      }

      // Step 3: Find shared-context books via entity overlap
      const sharedSlots = Math.max(0, 8 - directBooks.length);
      const sharedBooks = [];

      if (sharedSlots > 0) {
        const directIds = new Set(directBooks.map(b => b.id));
        const sharedResults = await entitiesCol.aggregate([
          { $match: { 'books.book_id': bookId, name: { $nin: [...UBIQUITOUS_ENTITIES] } } },
          { $unwind: '$books' },
          { $match: { 'books.book_id': { $ne: bookId, $nin: [...directIds] } } },
          { $group: {
            _id: '$books.book_id',
            title: { $first: '$books.book_title' },
            author: { $first: '$books.book_author' },
            shared_entities: { $sum: 1 },
            shared_names: { $push: '$name' },
          }},
          { $match: { shared_entities: { $gte: 5 } } },
          { $sort: { shared_entities: -1 } },
          { $limit: sharedSlots },
        ], { maxTimeMS: 10000 }).toArray();

        for (const result of sharedResults) {
          const targetBook = allBooks.find(b => (b.id || b._id?.toString()) === result._id);
          if (targetBook?.hidden) continue;
          sharedBooks.push({
            id: result._id,
            slug: targetBook?.slug,
            title: targetBook?.display_title || targetBook?.title || result.title,
            author: targetBook?.author || result.author || 'Unknown',
            published: targetBook?.published,
            shared_entities: result.shared_entities,
            shared_names: result.shared_names.slice(0, 5),
          });
        }
      }

      const relatedBooks = {
        direct: directBooks,
        shared: sharedBooks,
        computed_at: new Date(),
      };

      const totalRelated = directBooks.length + sharedBooks.length;

      if (dryRun) {
        if (totalRelated > 0) {
          console.log(`  ${book.title?.substring(0, 50)} — ${directBooks.length} direct, ${sharedBooks.length} shared`);
        }
      } else {
        await booksCol.updateOne(
          { id: bookId },
          { $set: { related_books: relatedBooks } }
        );
        if (totalRelated > 0) updated++;
      }

      if (processed % 200 === 0) {
        console.log(`  ${processed} processed, ${updated} updated`);
      }
    } catch (err) {
      console.error(`  Error processing ${bookId}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${processed} processed, ${updated} with related books, ${skipped} skipped`);
  await client.close();
}

function extractSurnames(author) {
  if (!author || author === 'Unknown' || author === 'Anonymous') return [];
  const surnames = [];
  // "Last, First" format
  if (author.includes(',')) {
    surnames.push(author.split(',')[0].trim().toLowerCase());
  } else {
    // "First Last" — take last word
    const parts = author.trim().split(/\s+/);
    if (parts.length > 0) {
      surnames.push(parts[parts.length - 1].toLowerCase());
    }
  }
  return surnames.filter(s => s.length >= 3);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
