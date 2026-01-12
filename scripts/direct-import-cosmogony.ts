/**
 * Direct MongoDB Import for Cosmogony Texts
 *
 * Bypasses API to import directly to database with pre-fetched metadata.
 * Run: node --import jiti/register scripts/direct-import-cosmogony.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';

// Pre-researched metadata for cosmogony texts
const COSMOGONY_TEXTS = [
  {
    ia_identifier: 'philonisalexandr0000phil',
    title: 'Philonis Alexandrini libellus De opificio mundi',
    author: 'Philo of Alexandria; ed. Leopold Cohn',
    year: 1889,
    original_language: 'Greek',
    page_count: 126, // From IA metadata
    notes: 'Critical edition of Greek text. Jewish-Hellenistic Genesis commentary.'
  },
  {
    ia_identifier: 'booksecretsenoc00morfgoog',
    title: 'The Book of the Secrets of Enoch (2 Enoch)',
    author: 'trans. W.R. Morfill; ed. R.H. Charles',
    year: 1896,
    original_language: 'Slavonic',
    page_count: 156,
    notes: 'First English translation. Seven heavens cosmology.'
  },
  {
    ia_identifier: 'hesiodtheogony0000mlwe',
    title: 'Hesiod: Theogony',
    author: 'Hesiod; ed. M.L. West',
    year: 1966,
    original_language: 'Greek',
    page_count: 459,
    notes: 'M.L. West critical edition with prolegomena.'
  },
  {
    ia_identifier: 'enumaelishvol1se0000leon',
    title: 'Enuma Elish Vol 1: The Seven Tablets of Creation',
    author: 'ed. Leonard William King',
    year: 1902,
    original_language: 'Akkadian',
    page_count: 254,
    notes: 'British Museum edition with cuneiform, transliteration, translation.'
  },
  {
    ia_identifier: 'babyloniancreati0000unse',
    title: 'Babylonian Creation Myths',
    author: 'W.G. Lambert',
    year: 2013,
    original_language: 'Akkadian',
    page_count: 648,
    notes: 'Comprehensive scholarly study of Mesopotamian cosmogonies.'
  }
];

async function importBook(client: MongoClient, book: typeof COSMOGONY_TEXTS[0]) {
  const db = client.db(MONGODB_DB);
  const booksCollection = db.collection('books');
  const pagesCollection = db.collection('pages');

  // Check if already exists
  const existing = await booksCollection.findOne({ ia_identifier: book.ia_identifier });
  if (existing) {
    console.log(`  ⚠ Already exists: ${book.title} (${existing._id})`);
    return { success: true, bookId: existing._id.toString(), skipped: true };
  }

  const bookId = new ObjectId();
  const now = new Date();

  // Create book document
  const bookDoc = {
    _id: bookId,
    id: bookId.toString(),
    title: book.title,
    author: book.author,
    year: book.year,
    original_language: book.original_language,
    ia_identifier: book.ia_identifier,
    source: 'ia',
    source_url: `https://archive.org/details/${book.ia_identifier}`,
    page_count: book.page_count,
    pages_count: book.page_count,
    pages_ocr: 0,
    pages_translated: 0,
    ocr_status: 'pending',
    translation_status: 'not_started',
    created_at: now,
    updated_at: now,
    curator_notes: book.notes
  };

  await booksCollection.insertOne(bookDoc);

  // Create page documents
  const pages = [];
  for (let i = 0; i < book.page_count; i++) {
    pages.push({
      book_id: bookId.toString(),
      page_number: i,
      image_url: `https://archive.org/download/${book.ia_identifier}/page/n${i}/full/pct:100/0/default.jpg`,
      ocr: null,
      translation: null,
      created_at: now
    });
  }

  if (pages.length > 0) {
    await pagesCollection.insertMany(pages);
  }

  console.log(`  ✓ Imported: ${book.title}`);
  console.log(`    Book ID: ${bookId.toString()}`);
  console.log(`    Pages: ${book.page_count}`);

  return { success: true, bookId: bookId.toString(), skipped: false };
}

async function main() {
  console.log('='.repeat(60));
  console.log('DIRECT MONGODB IMPORT: Cosmogony Texts');
  console.log('='.repeat(60));

  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const results = [];
    for (const book of COSMOGONY_TEXTS) {
      console.log(`\nImporting: ${book.title}`);
      console.log(`  IA: ${book.ia_identifier}`);
      const result = await importBook(client, book);
      results.push({ ...result, title: book.title });
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const imported = results.filter(r => r.success && !r.skipped);
    const skipped = results.filter(r => r.skipped);

    console.log(`\nNewly imported: ${imported.length}`);
    for (const r of imported) {
      console.log(`  - ${r.title} (${r.bookId})`);
    }

    if (skipped.length > 0) {
      console.log(`\nSkipped (already exist): ${skipped.length}`);
      for (const r of skipped) {
        console.log(`  - ${r.title}`);
      }
    }

    // Output book IDs for OCR
    const bookIds = imported.map(r => r.bookId);
    if (bookIds.length > 0) {
      console.log('\n\nBook IDs for OCR queue:');
      console.log(JSON.stringify(bookIds, null, 2));
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
