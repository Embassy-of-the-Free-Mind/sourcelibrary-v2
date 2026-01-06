/**
 * Extend book pages without losing existing OCR/translations
 *
 * For books where we have valuable translations but are missing pages,
 * this adds new page records for the missing pages while preserving
 * all existing OCR/translation work.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

interface BookToExtend {
  id: string;
  title: string;
  ia_identifier: string;
  currentPages: number;
  correctPages: number;
}

const booksToExtend: BookToExtend[] = [
  { id: '694b3b5b58a47807cc735dce', title: 'De revolutionibus', ia_identifier: 'ARes18421', currentPages: 209, correctPages: 413 },
  { id: '4f4ff6f9-f0bd-4307-910c-65da7c36c0ef', title: 'Pansophiae Diatyposis', ia_identifier: 'bub_gb_MGhEAAAAcAAJ', currentPages: 148, correctPages: 217 },
  { id: '6949af986ef4a68b726b7fa9', title: 'De architectura', ia_identifier: 'mvitrvviidearchi00vitr', currentPages: 328, correctPages: 484 },
  { id: '694d27e77219319474c057f4', title: 'Tetragonismus', ia_identifier: 'bub_gb_eZ04dG5e_JsC', currentPages: 34, correctPages: 65 },
  { id: '694a8046458d70b8c6439c5f', title: 'De vitis, dogmatis', ia_identifier: 'dionysiilambinid01john', currentPages: 476, correctPages: 560 },
  { id: '40124cb0-8498-477f-be31-bc2cd8ab4375', title: 'Manly Palmer Hall MSS', ia_identifier: 'manlypalmerhabox4v3hall', currentPages: 119, correctPages: 150 },
  { id: '69525858ab34727b1f0450cf', title: 'Aula Lucis', ia_identifier: 'aulalucisorhouse00vaug', currentPages: 64, correctPages: 98 },
];

function getPageImageUrl(ia_identifier: string, pageIndex: number): string {
  return `https://archive.org/download/${ia_identifier}/page/n${pageIndex}/full/pct:50/0/default.jpg`;
}

function getThumbnailUrl(ia_identifier: string, pageIndex: number): string {
  return `https://archive.org/download/${ia_identifier}/page/n${pageIndex}/full/pct:15/0/default.jpg`;
}

async function extendBook(
  db: ReturnType<MongoClient['db']>,
  book: BookToExtend
): Promise<{ added: number; error?: string }> {
  // Get the book's language from existing record
  const bookDoc = await db.collection('books').findOne({ id: book.id });
  if (!bookDoc) {
    return { added: 0, error: 'Book not found' };
  }

  const language = bookDoc.language || 'Unknown';

  // Check how many pages already exist
  const existingPageCount = await db.collection('pages').countDocuments({ book_id: book.id });

  if (existingPageCount >= book.correctPages) {
    return { added: 0, error: 'Already has enough pages' };
  }

  // Find the highest existing page number
  const highestPage = await db.collection('pages')
    .find({ book_id: book.id })
    .sort({ page_number: -1 })
    .limit(1)
    .toArray();

  const startFrom = highestPage.length > 0 ? highestPage[0].page_number + 1 : 1;
  const pagesToAdd = book.correctPages - (startFrom - 1);

  if (pagesToAdd <= 0) {
    return { added: 0, error: 'No pages to add' };
  }

  // Create new page documents
  const newPages = [];
  for (let pageNum = startFrom; pageNum <= book.correctPages; pageNum++) {
    const pageIndex = pageNum - 1; // 0-indexed for IA URLs
    const pageId = new ObjectId();

    newPages.push({
      _id: pageId,
      id: pageId.toHexString(),
      tenant_id: 'default',
      book_id: book.id,
      page_number: pageNum,
      photo: getPageImageUrl(book.ia_identifier, pageIndex),
      thumbnail: getThumbnailUrl(book.ia_identifier, pageIndex),
      photo_original: getPageImageUrl(book.ia_identifier, pageIndex),
      ocr: {
        language: language,
        model: null,
        data: ''
      },
      translation: {
        language: 'English',
        model: null,
        data: ''
      },
      created_at: new Date(),
      updated_at: new Date()
    });
  }

  // Insert new pages
  if (newPages.length > 0) {
    await db.collection('pages').insertMany(newPages);
  }

  // Update book's pages_count
  await db.collection('books').updateOne(
    { id: book.id },
    {
      $set: {
        pages_count: book.correctPages,
        updated_at: new Date()
      }
    }
  );

  return { added: newPages.length };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB);

    console.log('Extending 7 books with missing pages (preserving translations)...\n');

    let totalAdded = 0;

    for (const book of booksToExtend) {
      const missing = book.correctPages - book.currentPages;
      process.stdout.write(`${book.title} (${book.currentPages} → ${book.correctPages}, +${missing})... `);

      const result = await extendBook(db, book);

      if (result.error) {
        console.log(`⚠️  ${result.error}`);
      } else {
        console.log(`✓ Added ${result.added} pages`);
        totalAdded += result.added;
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Total pages added: ${totalAdded}`);
    console.log('All translations preserved!');

  } finally {
    await client.close();
  }
}

main().catch(console.error);
