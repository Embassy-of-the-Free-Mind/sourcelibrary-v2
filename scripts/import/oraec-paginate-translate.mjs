#!/usr/bin/env node
/**
 * Paginate ORAEC single-page imports into multi-page books with English translation.
 *
 * Takes the single-page ORAEC imports (all sentences on one page, German translation)
 * and splits them into ~25 sentences per page, translating German → English via Gemini.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/oraec-paginate-translate.mjs --book-id 69e15811ec0a328a49d0a242
 *   node scripts/import/oraec-paginate-translate.mjs --all    # process all ORAEC books
 *
 * Flags:
 *   --book-id ID         Process a single book
 *   --all                Process all ORAEC books
 *   --lines-per-page N   Sentences per page (default: 25)
 *   --dry-run            Print plan without writing
 */
import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { makePageDoc } from '../lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const BOOK_ID = getFlag('book-id', null);
const ALL = args.includes('--all');
const LINES_PER_PAGE = parseInt(getFlag('lines-per-page', '25'), 10);
const DRY_RUN = args.includes('--dry-run');

if (!BOOK_ID && !ALL) {
  console.error('Specify --book-id ID or --all');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

/**
 * Translate German Egyptological translation to English using Gemini.
 */
async function translateToEnglish(germanText, title) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are translating scholarly German Egyptological translations into English.
The source text is a German translation of an ancient Egyptian text: "${title}".

Translate the following numbered German sentences into English. Keep the same numbering.
Preserve parenthetical scholarly notes (these explain alternative readings or literal meanings).
Keep the academic register — this is for a scholarly digital edition.

German text:
${germanText}

Provide ONLY the English translation, keeping the exact same numbered format.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function processBook(db, bookId) {
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { _id: new ObjectId(bookId) }] },
    { projection: { id: 1, _id: 1, title: 1, slug: 1, oraec_sentence_count: 1 } }
  );
  if (!book) { console.error('Book not found:', bookId); return; }

  const bid = book.id || book._id.toHexString();
  console.log(`\nProcessing: ${book.title} (${bid})`);

  // Get the single page
  const pages = await db.collection('pages').find(
    { book_id: bid },
    { projection: { _id: 1, id: 1, 'ocr.data': 1, 'translation.data': 1, page_number: 1, photo: 1, archived_photo: 1, thumbnail: 1 } }
  ).sort({ page_number: 1 }).toArray();

  if (pages.length !== 1) {
    console.log(`  Skipping — already has ${pages.length} pages`);
    return;
  }

  const sourcePage = pages[0];
  const ocrBlocks = sourcePage.ocr?.data?.split('\n\n') || [];
  const transBlocks = sourcePage.translation?.data?.split('\n\n') || [];

  if (ocrBlocks.length !== transBlocks.length) {
    console.warn(`  WARNING: OCR blocks (${ocrBlocks.length}) != translation blocks (${transBlocks.length})`);
  }

  const totalSentences = Math.min(ocrBlocks.length, transBlocks.length);
  const numPages = Math.ceil(totalSentences / LINES_PER_PAGE);
  console.log(`  ${totalSentences} sentences → ${numPages} pages (${LINES_PER_PAGE}/page)`);

  if (DRY_RUN) {
    for (let p = 0; p < numPages; p++) {
      const start = p * LINES_PER_PAGE;
      const end = Math.min(start + LINES_PER_PAGE, totalSentences);
      console.log(`  Page ${p + 1}: sentences ${start + 1}-${end}`);
    }
    return;
  }

  // Park the old single page on a temp book_id so the new pages can use page_number: 1,2,...
  // The book remains pointing at the new pages by book_id. We delete the parked page only
  // after the new pages are fully written — this prevents a 0-pages book if we crash.
  const tempBookId = `__paginate_temp_${bid}_${Date.now()}`;
  await db.collection('pages').updateOne(
    { _id: sourcePage._id },
    { $set: { book_id: tempBookId } }
  );

  // Create new pages with English translation
  let totalTranslated = 0;
  for (let p = 0; p < numPages; p++) {
    const start = p * LINES_PER_PAGE;
    const end = Math.min(start + LINES_PER_PAGE, totalSentences);
    const pageNum = p + 1;

    const ocrChunk = ocrBlocks.slice(start, end).join('\n\n');
    const germanChunk = transBlocks.slice(start, end).join('\n\n');

    // Translate German → English
    let englishChunk;
    try {
      englishChunk = await translateToEnglish(germanChunk, book.title);
      totalTranslated += (end - start);
      // Rate limit
      await sleep(1000);
    } catch (err) {
      console.error(`  Translation failed for page ${pageNum}: ${err.message}`);
      englishChunk = germanChunk; // Fallback to German
    }

    const pageId = new ObjectId();
    const pageDoc = makePageDoc({
      _id: pageId,
      id: pageId.toHexString(),
      book_id: bid,
      page_number: pageNum,
      // First page gets the archived image, rest get null
      photo: pageNum === 1 ? (sourcePage.archived_photo || sourcePage.photo) : null,
      archived_photo: pageNum === 1 ? sourcePage.archived_photo : null,
      thumbnail: pageNum === 1 ? sourcePage.thumbnail : null,
      ocr: {
        data: ocrChunk,
        model: 'oraec-corpus',
        updated_at: new Date(),
      },
      translation: {
        data: englishChunk,
        model: 'gemini-2.0-flash',
        language: 'en',
        updated_at: new Date(),
      },
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.collection('pages').insertOne(pageDoc);
    process.stdout.write(`  [${pageNum}/${numPages}] sentences ${start + 1}-${end} ✓\n`);
  }

  // Now that new pages are written, delete the parked old page.
  await db.collection('pages').deleteOne({ _id: sourcePage._id });

  // Update book counts
  await db.collection('books').updateOne(
    { _id: book._id },
    { $set: {
      pages_count: numPages,
      pages_ocr: numPages,
      pages_translated: numPages,
      language: 'Egyptian hieroglyphs',
      updated_at: new Date(),
    }}
  );

  console.log(`  Done: ${numPages} pages, ${totalTranslated} sentences translated to English`);
}

async function sweepStaleTempPages(db) {
  // Clean up pages parked on temp book_ids from crashed prior runs.
  const sweep = await db.collection('pages').deleteMany(
    { book_id: { $regex: /^__paginate_temp_/ } }
  );
  if (sweep.deletedCount > 0) {
    console.log(`Swept ${sweep.deletedCount} stale paginate-temp pages from prior crashes`);
  }
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  // Clean up any temp pages left from prior crashed runs before starting.
  await sweepStaleTempPages(db);

  if (BOOK_ID) {
    await processBook(db, BOOK_ID);
  } else if (ALL) {
    const books = await db.collection('books').find(
      { 'image_source.provider': 'oraec' },
      { projection: { id: 1 } }
    ).toArray();
    console.log(`Found ${books.length} ORAEC books`);
    for (const book of books) {
      await processBook(db, book.id);
    }
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
