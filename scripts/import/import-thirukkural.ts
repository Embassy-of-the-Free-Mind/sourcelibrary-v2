/**
 * Direct MongoDB Import: Thirukkural Editions
 *
 * Bypasses API auth to import directly to database.
 * Fetches page counts from IA IIIF manifests (same logic as /api/import/ia).
 *
 * Run: secret-lover run -- npx tsx scripts/import-thirukkural.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.local' });

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';

interface BookImport {
  ia_identifier: string;
  title: string;
  author: string;
  language: string;
  published: string;
  year?: number;
  category?: string;
  notes?: string;
}

const THIRUKKURAL_EDITIONS: BookImport[] = [
  {
    ia_identifier: 'gc-sh5-0323',
    title: 'Tiruvaḷḷuvar Kuṟaḷ (with Parimelazagar Commentary)',
    author: 'Tiruvalluvar (comm. Parimelazagar & Iramanucakkavirayar)',
    language: 'Tamil',
    published: '1840',
    year: 1840,
    category: 'philosophy',
    notes: 'Early printed edition (Chennai, 1840) with classical commentaries by Parimelazagar and Iramanucakkavirayar. From François Gros collection.'
  },
  {
    ia_identifier: 'kuraloftiruvallu00tirurich',
    title: 'The Kural of Tiruvalluvar (Parimelazagar Commentary with English Translation)',
    author: 'Tiruvalluvar (ed. Mrugesa Mudaliyar, trans. John Lazarus)',
    language: 'Tamil',
    published: '1885',
    year: 1885,
    category: 'philosophy',
    notes: 'Bilingual Tamil-English scholarly edition with Parimelazagar medieval commentary, padavurai, and English translation by J. Lazarus.'
  },
  {
    ia_identifier: '11ThirukkuralParimelAlagarArumugaNavalarGood',
    title: 'Thirukkural (Arumuga Navalar Edition with Parimelazagar Commentary)',
    author: 'Tiruvalluvar (ed. Arumuga Navalar, comm. Parimelazagar)',
    language: 'Tamil',
    published: '1861',
    year: 1861,
    category: 'philosophy',
    notes: 'Authoritative critical edition prepared by Arumuga Navalar with Parimelazagar commentary. Navalar editions are considered standards of Tamil philology.'
  }
];

async function getPageCount(ia_identifier: string): Promise<{ count: number; source: string }> {
  // 1. Try IIIF manifest (most reliable)
  try {
    const iiifRes = await fetch(
      `https://iiif.archive.org/iiif/${ia_identifier}/manifest.json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (iiifRes.ok) {
      const manifest = await iiifRes.json();
      if (manifest.items) {
        return { count: manifest.items.length, source: 'iiif_v3' };
      }
      if (manifest.sequences?.[0]?.canvases) {
        return { count: manifest.sequences[0].canvases.length, source: 'iiif_v2' };
      }
    }
  } catch {
    // Fall through
  }

  // 2. Try IA metadata
  try {
    const metaRes = await fetch(`https://archive.org/metadata/${ia_identifier}`);
    if (metaRes.ok) {
      const meta = await metaRes.json();
      if (meta.metadata?.imagecount) {
        return { count: parseInt(meta.metadata.imagecount, 10), source: 'imagecount' };
      }
      const jp2Files = (meta.files || []).filter(
        (f: { name: string }) => f.name.endsWith('.jp2') && !f.name.includes('thumb')
      );
      if (jp2Files.length > 1) {
        return { count: jp2Files.length, source: 'jp2_files' };
      }
    }
  } catch {
    // Fall through
  }

  return { count: 0, source: 'unknown' };
}

async function importBook(client: MongoClient, book: BookImport) {
  const db = client.db(MONGODB_DB);
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');

  // Check duplicates
  const existing = await booksCol.findOne({
    $or: [
      { ia_identifier: book.ia_identifier },
      { 'dublin_core.dc_identifier': `IA:${book.ia_identifier}` }
    ]
  });

  if (existing) {
    console.log(`  Already exists: ${book.title} (${existing._id})`);
    return { success: true, bookId: existing._id.toString(), skipped: true };
  }

  // Get page count from IA
  console.log(`  Fetching page count from IA...`);
  const { count: pageCount, source: pageCountSource } = await getPageCount(book.ia_identifier);

  if (pageCount === 0) {
    console.error(`  ERROR: Could not determine page count for ${book.ia_identifier}`);
    return { success: false, bookId: '', skipped: false };
  }
  console.log(`  Pages: ${pageCount} (from ${pageCountSource})`);

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const now = new Date();

  const getPageImageUrl = (n: number) =>
    `https://archive.org/download/${book.ia_identifier}/page/n${n}/full/full/0/default.jpg`;
  const getThumbnailUrl = (n: number) =>
    `https://archive.org/download/${book.ia_identifier}/page/n${n}/full/pct:15/0/default.jpg`;

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    title: book.title,
    display_title: null,
    author: book.author,
    language: book.language,
    published: book.published,
    categories: book.category ? [book.category] : [],
    ia_identifier: book.ia_identifier,
    thumbnail: getThumbnailUrl(0),
    pages_count: pageCount,
    pages_ocr: 0,
    pages_translated: 0,
    dublin_core: {
      dc_identifier: [`IA:${book.ia_identifier}`],
      dc_source: `https://archive.org/details/${book.ia_identifier}`
    },
    image_source: {
      provider: 'internet_archive',
      provider_name: 'Internet Archive',
      source_url: `https://archive.org/details/${book.ia_identifier}`,
      identifier: book.ia_identifier,
      license: 'publicdomain',
      access_date: now
    },
    page_count_source: pageCountSource,
    status: 'draft',
    curator_notes: book.notes,
    created_at: now,
    updated_at: now
  };

  await booksCol.insertOne(bookDoc);

  // Create pages
  const pageDocs = [];
  for (let i = 0; i < pageCount; i++) {
    const pageId = new ObjectId();
    pageDocs.push({
      _id: pageId,
      id: pageId.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      photo: getPageImageUrl(i),
      thumbnail: getThumbnailUrl(i),
      photo_original: getPageImageUrl(i),
      ocr: { language: book.language, model: null, data: '' },
      translation: { language: 'English', model: null, data: '' },
      created_at: now,
      updated_at: now
    });
  }

  // Insert in batches of 500 to avoid memory issues
  for (let i = 0; i < pageDocs.length; i += 500) {
    await pagesCol.insertMany(pageDocs.slice(i, i + 500));
  }

  console.log(`  Imported: ${book.title}`);
  console.log(`  Book ID: ${bookIdStr}`);
  console.log(`  URL: https://sourcelibrary.org/book/${bookIdStr}`);
  console.log(`  Pages: ${pageCount}`);

  return { success: true, bookId: bookIdStr, skipped: false };
}

async function main() {
  console.log('='.repeat(60));
  console.log('IMPORT: Thirukkural Editions');
  console.log('='.repeat(60));

  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set. Run with: secret-lover run -- npx tsx scripts/import-thirukkural.ts');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const results = [];
    for (const book of THIRUKKURAL_EDITIONS) {
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
    const failed = results.filter(r => !r.success);

    console.log(`\nNewly imported: ${imported.length}`);
    for (const r of imported) {
      console.log(`  - ${r.title}`);
      console.log(`    https://sourcelibrary.org/book/${r.bookId}`);
    }

    if (skipped.length > 0) {
      console.log(`\nSkipped (already exist): ${skipped.length}`);
      for (const r of skipped) console.log(`  - ${r.title}`);
    }
    if (failed.length > 0) {
      console.log(`\nFailed: ${failed.length}`);
      for (const r of failed) console.log(`  - ${r.title}`);
    }
  } finally {
    await client.close();
  }
}

main().catch(console.error);
