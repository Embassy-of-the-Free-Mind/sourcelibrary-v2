#!/usr/bin/env node
/**
 * Pre-compute related books for each book and store as book.related_books.
 *
 * Replaces the old live query approach (removed in 34973d7e) that ran 4-6
 * expensive MongoDB queries per page render.
 *
 * Two relationship types:
 * - "direct": this book mentions a person (entity) who authored another book in our library
 * - "shared": books sharing 5+ entity mentions (intellectual context)
 *
 * Flags:
 *   --dry-run     Show what would be written without updating MongoDB
 *   --book <id>   Process a single book by its id
 *   --force       Recompute even if related_books already exists
 *
 * Run:
 *   set -a; source .env.production.local; set +a; node scripts/backfill-related-books.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const SINGLE_BOOK_IDX = process.argv.indexOf('--book');
const SINGLE_BOOK_ID = SINGLE_BOOK_IDX !== -1 ? process.argv[SINGLE_BOOK_IDX + 1] : null;

// Entities too common to be meaningful shared-context signals
const UBIQUITOUS_ENTITIES = new Set([
  'Jesus Christ', 'God', 'The Devil', 'Satan', 'Lucifer',
  'Moses', 'Abraham', 'Adam', 'Eve', 'Noah', 'David',
  'Hermes Trismegistus', 'Hermes', 'Mercury',
  'Aristotle', 'Plato', 'Socrates',
  'The Holy Spirit', 'The Son of God', 'The Apostles',
  'The Patriarchs', 'The Prophets',
]);

async function computeRelatedBooks(db, bookId, bookAuthor) {
  const entitiesCol = db.collection('entities');
  const booksCol = db.collection('books');

  // Step 1: Find person entities mentioned in this book
  const personEntities = await entitiesCol.find(
    { type: 'person', 'books.book_id': bookId },
    { projection: { name: 1, aliases: 1 } },
  ).toArray();

  // Step 2: For each person entity, check if they authored other books
  const directCitationBookIds = new Map(); // bookId -> cited_as

  const entityNames = [];
  for (const entity of personEntities) {
    // Only use multi-word names or long single-word names to avoid false matches
    const names = [entity.name, ...(entity.aliases || [])].filter(
      (n) => n && (n.includes(' ') ? n.length >= 4 : n.length >= 10),
    );
    if (names.length > 0) {
      entityNames.push({ names, entityName: entity.name });
    }
  }

  if (entityNames.length > 0) {
    const allNames = [];
    for (const { names, entityName } of entityNames) {
      for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        allNames.push({ pattern: escaped, entityName });
      }
    }

    const combinedPattern = allNames.map(n => n.pattern).join('|');
    const candidateBooks = await booksCol.find(
      {
        id: { $ne: bookId },
        hidden: { $ne: true },
        author: { $regex: combinedPattern, $options: 'i' },
      },
      { projection: { id: 1, author: 1 } },
    ).toArray();

    for (const doc of candidateBooks) {
      const authorLower = (doc.author || '').toLowerCase();
      for (const { pattern, entityName } of allNames) {
        const re = new RegExp(`(?<![a-z])${pattern}(?![a-z])`, 'i');
        if (re.test(authorLower)) {
          directCitationBookIds.set(doc.id, entityName);
          break;
        }
      }
    }
  }

  // Step 3: Enrich direct citations with book metadata
  let directBooks = [];
  if (directCitationBookIds.size > 0) {
    const bookDocs = await booksCol.find(
      { id: { $in: [...directCitationBookIds.keys()] }, hidden: { $ne: true } },
      { projection: { id: 1, display_title: 1, title: 1, author: 1, slug: 1 } },
    ).toArray();

    for (const doc of bookDocs) {
      directBooks.push({
        id: doc.slug || doc.id,
        title: doc.display_title || doc.title || 'Untitled',
        author: doc.author || 'Unknown',
        cited_as: directCitationBookIds.get(doc.id),
      });
    }
  }

  // Exclude same-author books (covered by "More by Author")
  if (bookAuthor && bookAuthor !== 'Unknown') {
    const surname = bookAuthor.split(/[,;]/)[0].trim().toLowerCase();
    if (surname.length >= 4) {
      directBooks = directBooks.filter(b =>
        !b.author.toLowerCase().includes(surname) &&
        !(b.cited_as || '').toLowerCase().includes(surname),
      );
    }
  }

  // Deduplicate: max 1 book per cited entity
  const seenEntities = new Set();
  directBooks = directBooks.filter(b => {
    const key = b.cited_as || b.id;
    if (seenEntities.has(key)) return false;
    seenEntities.add(key);
    return true;
  });
  if (directBooks.length > 6) directBooks.length = 6;

  // Step 4: Shared entity context
  const sharedSlots = Math.max(0, 8 - directBooks.length);
  let sharedBooks = [];

  if (sharedSlots > 0) {
    const directIds = new Set(directBooks.map(b => b.id));

    const sharedResults = await entitiesCol.aggregate([
      { $match: { 'books.book_id': bookId } },
      { $unwind: '$books' },
      { $match: { 'books.book_id': { $ne: bookId, $nin: [...directIds] } } },
      { $group: {
        _id: '$books.book_id',
        shared_entities: { $sum: 1 },
        shared_names: { $push: '$name' },
      }},
      { $match: { shared_entities: { $gte: 5 } } },
      { $sort: { shared_entities: -1 } },
      { $limit: sharedSlots },
      { $lookup: {
        from: 'books',
        localField: '_id',
        foreignField: 'id',
        pipeline: [{ $project: { display_title: 1, title: 1, author: 1, hidden: 1, slug: 1 } }],
        as: 'book_doc',
      }},
      { $unwind: { path: '$book_doc', preserveNullAndEmptyArrays: true } },
      { $match: { 'book_doc.hidden': { $ne: true } } },
    ]).toArray();

    sharedBooks = sharedResults.map(r => ({
      id: r.book_doc?.slug || r._id,
      title: r.book_doc?.display_title || r.book_doc?.title || 'Untitled',
      author: r.book_doc?.author || 'Unknown',
      shared_count: r.shared_entities,
      shared_names: (r.shared_names || [])
        .filter(n => !UBIQUITOUS_ENTITIES.has(n))
        .slice(0, 3),
    }));
  }

  return { direct: directBooks, shared: sharedBooks };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');

  console.log(DRY_RUN ? '[DRY RUN] No changes will be written.\n' : '');

  // Build book query
  const query = { hidden: { $ne: true } };
  if (SINGLE_BOOK_ID) {
    query.id = SINGLE_BOOK_ID;
  } else if (!FORCE) {
    // Skip books that already have related_books computed
    query.related_books = { $exists: false };
  }

  const books = await booksCol.find(query, {
    projection: { id: 1, author: 1, display_title: 1, title: 1 },
  }).toArray();

  console.log(`Processing ${books.length} books...\n`);

  let updated = 0;
  let empty = 0;
  let errors = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const label = `[${i + 1}/${books.length}] ${book.display_title || book.title || book.id}`;

    try {
      const { direct, shared } = await computeRelatedBooks(db, book.id, book.author);

      if (direct.length === 0 && shared.length === 0) {
        empty++;
        if (SINGLE_BOOK_ID) {
          console.log(`${label}: no related books found`);
        }
        // Still store the empty result so we don't recompute next time
        if (!DRY_RUN) {
          await booksCol.updateOne(
            { id: book.id },
            { $set: { related_books: { direct: [], shared: [], computed_at: new Date() } } },
          );
        }
        continue;
      }

      console.log(`${label}: ${direct.length} direct, ${shared.length} shared`);
      if (direct.length > 0) {
        for (const d of direct) {
          console.log(`  [direct] ${d.title} (via ${d.cited_as})`);
        }
      }
      if (shared.length > 0) {
        for (const s of shared) {
          console.log(`  [shared] ${s.title} (${s.shared_count} entities: ${s.shared_names?.join(', ')})`);
        }
      }

      if (!DRY_RUN) {
        await booksCol.updateOne(
          { id: book.id },
          { $set: { related_books: { direct, shared, computed_at: new Date() } } },
        );
      }
      updated++;
    } catch (err) {
      errors++;
      console.error(`${label}: ERROR - ${err.message}`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Empty: ${empty}, Errors: ${errors}`);
  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
