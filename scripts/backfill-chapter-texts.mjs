#!/usr/bin/env node
/**
 * Backfill chapter texts for all books that have chapters extracted
 * but no materialized chapter_texts yet.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/backfill-chapter-texts.mjs [--limit N] [--book-id ID]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
const bookIdArg = args.includes('--book-id') ? args[args.indexOf('--book-id') + 1] : null;

const client = new MongoClient(MONGODB_URI);

function computeEndPages(chapters, totalPages) {
  for (let i = 0; i < chapters.length; i++) {
    if (i < chapters.length - 1) {
      chapters[i].endPage = chapters[i + 1].pageNumber - 1;
    } else {
      chapters[i].endPage = totalPages;
    }
  }
  return chapters;
}

async function materializeBook(db, book) {
  const chapters = computeEndPages(book.chapters, book.pages_count || 0);

  const pages = await db.collection('pages')
    .find(
      { book_id: book.id },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
    )
    .sort({ page_number: 1 })
    .toArray();

  const pageMap = new Map();
  for (const p of pages) {
    pageMap.set(p.page_number, {
      ocr: p.ocr?.data || undefined,
      translation: p.translation?.data || undefined,
    });
  }

  const docs = [];
  let totalTokens = 0;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const startPage = ch.pageNumber;
    const endPage = ch.endPage || book.pages_count || 0;
    const translationParts = [];
    const ocrParts = [];

    // Start with chapter header for structural context
    const chapterLabel = ch.titleEn
      ? `# ${ch.title}\n## ${ch.titleEn}`
      : `# ${ch.title}`;
    translationParts.push(chapterLabel);
    ocrParts.push(`# ${ch.title}`);

    for (let pn = startPage; pn <= endPage; pn++) {
      const page = pageMap.get(pn);
      if (!page) continue;
      const marker = `[Page ${pn}]`;
      if (page.translation) {
        translationParts.push(`${marker}\n${page.translation}`);
      } else if (page.ocr) {
        translationParts.push(`${marker}\n${page.ocr}`);
      }
      if (page.ocr) {
        ocrParts.push(`${marker}\n${page.ocr}`);
      }
    }

    const text = translationParts.join('\n\n');
    const ocrText = ocrParts.join('\n\n');
    const tokenEstimate = Math.round(text.length / 4);
    totalTokens += tokenEstimate;

    docs.push({
      book_id: book.id,
      chapter_index: i,
      title: ch.title,
      titleEn: ch.titleEn,
      level: ch.level,
      pageStart: startPage,
      pageEnd: endPage,
      text,
      ocr_text: ocrText || undefined,
      token_estimate: tokenEstimate,
      materialized_at: new Date(),
    });
  }

  await db.collection('chapter_texts').deleteMany({ book_id: book.id });
  if (docs.length > 0) {
    await db.collection('chapter_texts').insertMany(docs);
  }

  // Update book with endPages
  try {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { chapters, chapter_texts_at: new Date() } },
    );
  } catch (err) {
    if (err.message?.includes('larger than the maximum size')) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { chapter_texts_at: new Date() } },
      );
    } else {
      throw err;
    }
  }

  return { chapters: docs.length, totalTokens };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Ensure index on chapter_texts
  await db.collection('chapter_texts').createIndex({ book_id: 1, chapter_index: 1 });

  // Find books with chapters but no materialized text
  const filter = {
    'chapters.0': { $exists: true },
    ...(bookIdArg ? { id: bookIdArg } : { chapter_texts_at: { $exists: false } }),
  };

  const cursor = db.collection('books')
    .find(filter, { projection: { id: 1, title: 1, chapters: 1, pages_count: 1 } })
    .sort({ pages_count: -1 });

  if (limitArg > 0) cursor.limit(limitArg);

  const books = await cursor.toArray();
  console.log(`Found ${books.length} books to materialize`);

  let done = 0;
  let totalChapters = 0;
  let totalTokens = 0;

  for (const book of books) {
    try {
      const result = await materializeBook(db, book);
      totalChapters += result.chapters;
      totalTokens += result.totalTokens;
      done++;
      if (done % 50 === 0 || done === books.length) {
        console.log(`  ${done}/${books.length} — ${totalChapters} chapters, ~${Math.round(totalTokens / 1000)}K tokens`);
      }
    } catch (err) {
      console.error(`  Error on ${book.id} (${book.title}): ${err.message}`);
    }
  }

  console.log(`\nDone: ${done} books, ${totalChapters} chapters, ~${Math.round(totalTokens / 1000)}K tokens total`);
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
