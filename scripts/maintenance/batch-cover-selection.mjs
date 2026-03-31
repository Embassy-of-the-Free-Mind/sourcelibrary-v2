/**
 * Batch AI Cover Selection
 *
 * Uses Gemini Vision to pick the best cover for each book.
 * Sends first N page images to Gemini and asks it to select
 * the most visually appealing frontispiece/title page.
 *
 * Cost: ~$0.005-0.010 per book (gemini-3-flash-preview)
 * Estimated total: ~$67 for 6,700 books
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/batch-cover-selection.mjs
 *   node scripts/maintenance/batch-cover-selection.mjs --dry-run
 *   node scripts/maintenance/batch-cover-selection.mjs --limit 50
 *   node scripts/maintenance/batch-cover-selection.mjs --book-id abc123
 *   node scripts/maintenance/batch-cover-selection.mjs --skip-manual   # skip thumbnail_source: 'manual'
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_MANUAL = process.argv.includes('--skip-manual');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const BOOK_ID = (() => {
  const idx = process.argv.indexOf('--book-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const CONCURRENCY = (() => {
  const idx = process.argv.indexOf('--concurrency');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 5;
})();
const MAX_PAGES = 15; // pages to analyze per book

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const PROMPT = `You are a rare book librarian selecting the best cover image for a digitized historical book.
Analyze these page images (in order, starting from page 1) and select the BEST cover image.

CRITERIA (in priority order):
1. **Frontispiece/Title page** - Decorative title page with:
   - Centered text with title/author
   - Decorative borders, frames, or ornamental elements
   - Publisher information (Latin: "excudebat", "typis", "apud", "impensis")
   - Emblems, engravings, or allegorical imagery
   - Architectural frames or columns

2. **Visual quality** - The image should be:
   - Clear and legible (not blurry, faded, or damaged)
   - Well-composed with good symmetry
   - Visually appealing and representative of the book

3. **Avoid** - Do NOT select:
   - Blank pages or copyright pages
   - Plain text-only pages with no decoration
   - Tables of contents or indices
   - Pages with modern stamps/labels
   - Severely damaged or illegible pages
   - **Digitizer insert pages** — pages added by Internet Archive, Google Books, or other digitizers (credit pages, "Digitized by Google" notices, barcodes, scan sheets). These are often dark/black with logos and are NOT part of the original book.

RESPONSE FORMAT:
Return ONLY a JSON object with this exact structure:
{
  "selected_page_number": 1,
  "rationale": "Brief 1-2 sentence explanation of why this page is best",
  "confidence": "high"
}

The selected_page_number should be the index (1-based) of which image you selected from those provided.
Confidence levels: "high" = clear frontispiece, "medium" = decent title page, "low" = all pages poor quality.`;

// --- Helpers ---

function getPageImageUrl(page) {
  const isUsable = (u) => u && (u.startsWith('http://') || u.startsWith('https://'));
  if (isUsable(page.cropped_photo)) return page.cropped_photo;
  if (isUsable(page.archived_photo)) return page.archived_photo;
  if (page.archived_photo?.startsWith('failed:')) return null;
  if (isUsable(page.photo)) return page.photo;
  if (isUsable(page.photo_original)) return page.photo_original;
  return null;
}

async function fetchImageBase64(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      return { base64, mimeType: contentType };
    } catch (e) {
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

async function selectCover(genModel, book, pages) {
  const imageParts = [];
  const pageMap = new Map();

  for (const page of pages) {
    const url = getPageImageUrl(page);
    if (!url) continue;

    const img = await fetchImageBase64(url);
    if (!img) continue;

    imageParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    pageMap.set(imageParts.length, { pageNumber: page.page_number, url });
  }

  if (imageParts.length === 0) return null;

  const result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: PROMPT }, ...imageParts] }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' },
  });

  const text = result.response.text().trim();
  const parsed = JSON.parse(text);
  const usage = result.response.usageMetadata;

  const selected = pageMap.get(parsed.selected_page_number);
  if (!selected) return null;

  return {
    url: selected.url,
    pageNumber: selected.pageNumber,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
  };
}

// --- Main ---

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-3-flash-preview' });

console.log(`\n=== Batch AI Cover Selection ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Concurrency: ${CONCURRENCY} | Pages/book: ${MAX_PAGES}`);
if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Fetch books — skip manually-set covers by default
const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : { pages_count: { $gt: 0 }, visible: true };

if (!BOOK_ID && SKIP_MANUAL) {
  bookQuery.thumbnail_source = { $ne: 'manual' };
}

const allBooks = await db.collection('books')
  .find(bookQuery, { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1, _id: 0 } })
  .toArray();

console.log(`Found ${allBooks.length} books to process.\n`);

let processed = 0, upgraded = 0, failed = 0, skipped = 0;
let totalInputTokens = 0, totalOutputTokens = 0;
const startTime = Date.now();

// Process in concurrent batches
const queue = LIMIT ? allBooks.slice(0, LIMIT) : [...allBooks];

async function processBook(book) {
  try {
    const pages = await db.collection('pages')
      .find({ book_id: book.id }, {
        projection: { page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, _id: 0 }
      })
      .sort({ page_number: 1 })
      .limit(MAX_PAGES)
      .toArray();

    if (!pages || pages.length < 2) { skipped++; return; }

    const result = await selectCover(model, book, pages);
    if (!result) { skipped++; return; }

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    // Check if it picked a different page than current cover
    const currentThumb = book.thumbnail || '';
    const isSame = currentThumb === result.url;

    if (isSame) {
      skipped++;
      return;
    }

    upgraded++;
    const shortTitle = (book.title || '').substring(0, 55);
    console.log(`  ${shortTitle}`);
    console.log(`    → page ${result.pageNumber} (${result.confidence}) | ${result.rationale}`);

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          thumbnail: result.url,
          thumbnail_source: 'ai_vision',
          cover_updated_at: new Date(),
          cover_rationale: result.rationale,
          cover_confidence: result.confidence,
          cover_page_number: result.pageNumber,
        }}
      );
    }
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      // Rate limited — wait and retry
      console.log(`  Rate limited, waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
      queue.push(book); // re-queue
    } else {
      console.log(`  FAIL: ${(book.title || '').substring(0, 40)} — ${msg.substring(0, 80)}`);
    }
  } finally {
    processed++;
    if (processed % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const costEst = ((totalInputTokens / 1e6) * 0.10 + (totalOutputTokens / 1e6) * 0.40).toFixed(3);
      console.log(`\n  --- Progress: ${processed}/${queue.length} | Upgraded: ${upgraded} | Failed: ${failed} | Cost: $${costEst} | ${elapsed}s ---\n`);
    }
  }
}

// Run with concurrency control
let idx = 0;
async function worker() {
  while (idx < queue.length) {
    const book = queue[idx++];
    if (!book) break;
    await processBook(book);
  }
}

const workers = Array.from({ length: CONCURRENCY }, () => worker());
await Promise.all(workers);

// Summary
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const costEst = ((totalInputTokens / 1e6) * 0.10 + (totalOutputTokens / 1e6) * 0.40).toFixed(3);

console.log(`\n=== Results ===`);
console.log(`Processed: ${processed}`);
console.log(`Upgraded: ${upgraded}`);
console.log(`Skipped (same or no data): ${skipped}`);
console.log(`Failed: ${failed}`);
console.log(`Tokens: ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`);
console.log(`Estimated cost: $${costEst}`);
console.log(`Time: ${elapsed}s`);

if (DRY_RUN && upgraded > 0) {
  console.log(`\nRun without --dry-run to apply these changes.`);
}

await client.close();
