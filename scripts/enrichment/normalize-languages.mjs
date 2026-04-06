#!/usr/bin/env node
/**
 * Normalize language fields across all books:
 * 1. Fix ISO 639 codes and casing variants (free, instant)
 * 2. Use Gemini to infer language for "Unknown" books from title + author + page images
 *
 * Usage:
 *   secret-lover run -- node scripts/normalize-languages.mjs --dry-run
 *   secret-lover run -- node scripts/normalize-languages.mjs --apply
 *   secret-lover run -- node scripts/normalize-languages.mjs --apply --limit 100
 *   secret-lover run -- node scripts/normalize-languages.mjs --apply --skip-gemini
 */
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_BATCH_SIZE = 30; // books per Gemini call
const PAGES_FOR_INFERENCE = 3; // page images to send per book

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Deterministic mappings: ISO 639 codes, casing variants, common typos
const LANGUAGE_MAP = {
  'lat': 'Latin',
  'latin': 'Latin',
  'eng': 'English',
  'fre': 'French',
  'spa': 'Spanish',
  'ger': 'German',
  'ita': 'Italian',
  'dut': 'Dutch',
  'ara': 'Arabic',
  'heb': 'Hebrew',
  'gre': 'Greek',
  'per': 'Persian',
  'san': 'Sanskrit',
  'chi': 'Chinese',
  'jpn': 'Japanese',
  'kor': 'Korean',
  'rus': 'Russian',
  'por': 'Portuguese',
  'swe': 'Swedish',
  'tur': 'Turkish',
};

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
      }
    }
  } catch (e) { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const apiKeys = [];
if (env.GEMINI_API_KEY) apiKeys.push(env.GEMINI_API_KEY);
for (let i = 2; i <= 10; i++) {
  if (env[`GEMINI_API_KEY_${i}`]) apiKeys.push(env[`GEMINI_API_KEY_${i}`]);
}
let keyIndex = 0;
function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Gemini language inference ───────────────────────────────────────

async function inferLanguagesWithGemini(booksWithPages) {
  if (apiKeys.length === 0) return {};

  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, safetySettings: SAFETY_SETTINGS });

  // Build content parts: text prompt + images
  const parts = [];

  const bookList = booksWithPages.map((b, i) => ({
    index: i,
    id: b._id.toString(),
    title: b.title || b.display_title || '',
    author: b.author || '',
    published: b.published || '',
    imageCount: b.pageImages?.length || 0,
  }));

  parts.push({
    text: `You are a rare books librarian. For each book below, determine the primary language of the original text.

Use the title, author, date, and the page images provided to identify the language.
Common languages in this collection: Latin, Greek, German, French, English, Italian, Dutch, Arabic, Hebrew, Chinese, Sanskrit, Persian, Armenian, Syriac, Tamil, Spanish.

For bilingual books, use format "Language1-Language2" (e.g., "Latin-English").

Respond with JSON only — no markdown fences. Format: { "results": [ { "id": "...", "language": "Latin", "confidence": "high" }, ... ] }
Confidence: "high" (clearly identifiable), "medium" (likely but uncertain), "low" (guess).

Books:
${JSON.stringify(bookList.map(b => ({ id: b.id, title: b.title, author: b.author, published: b.published })), null, 2)}

Page images follow in order. Each group of ${PAGES_FOR_INFERENCE} images corresponds to the next book.`
  });

  // Add page images
  for (const book of booksWithPages) {
    for (const url of (book.pageImages || [])) {
      parts.push({
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: url,
        }
      });
    }
  }

  try {
    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const text = result.response.text().trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(clean);
    const map = {};
    for (const r of parsed.results || []) {
      if (r.language && typeof r.language === 'string' && r.language !== 'Unknown') {
        map[r.id] = { language: r.language, confidence: r.confidence || 'medium' };
      }
    }
    return map;
  } catch (e) {
    console.error(`  Gemini error: ${e.message}`);
    return {};
  }
}

// Text-only fallback for books without images
async function inferLanguagesTextOnly(books) {
  if (apiKeys.length === 0) return {};

  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, safetySettings: SAFETY_SETTINGS });

  const items = books.map(b => ({
    id: b._id.toString(),
    title: b.title || b.display_title || '',
    author: b.author || '',
    published: b.published || '',
    ocr_sample: b.ocrSample || '',
  }));

  const prompt = `You are a rare books librarian. For each book below, determine the primary language of the original text from its title, author, and OCR sample.

Common languages: Latin, Greek, German, French, English, Italian, Dutch, Arabic, Hebrew, Chinese, Sanskrit, Persian, Armenian, Syriac, Tamil, Spanish.
For bilingual books, use "Language1-Language2".

Respond with JSON only — no markdown fences. Format: { "results": [ { "id": "...", "language": "Latin", "confidence": "high" }, ... ] }

Books:
${JSON.stringify(items, null, 2)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(clean);
    const map = {};
    for (const r of parsed.results || []) {
      if (r.language && typeof r.language === 'string' && r.language !== 'Unknown') {
        map[r.id] = { language: r.language, confidence: r.confidence || 'medium' };
      }
    }
    return map;
  } catch (e) {
    console.error(`  Gemini text-only error: ${e.message}`);
    return {};
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function run() {
  const dryRun = !process.argv.includes('--apply');
  const skipGemini = process.argv.includes('--skip-gemini');
  const limitArg = process.argv.find(a => a.startsWith('--limit'));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] || process.argv[process.argv.indexOf(limitArg) + 1]) : 0;

  if (dryRun) console.log('DRY RUN — pass --apply to write changes\n');

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const pagesCol = db.collection('pages');

  // ── Phase 1: Deterministic mapping ──
  console.log('=== Phase 1: Deterministic language normalization ===');
  const updates1 = [];

  for (const [code, normalized] of Object.entries(LANGUAGE_MAP)) {
    const count = await booksCol.countDocuments({ language: code });
    if (count > 0) {
      console.log(`  "${code}" → "${normalized}": ${count} books`);
      updates1.push({ filter: { language: code }, update: { $set: { language: normalized } }, count });
    }
  }

  if (updates1.length > 0 && !dryRun) {
    for (const u of updates1) {
      await booksCol.updateMany(u.filter, u.update);
    }
    console.log(`  Applied ${updates1.reduce((s, u) => s + u.count, 0)} deterministic fixes`);
  }

  // ── Phase 2: Gemini for Unknown ──
  if (skipGemini) {
    console.log('\nSkipping Gemini inference (--skip-gemini)');
    await client.close();
    console.log('\nDone.');
    return;
  }

  console.log('\n=== Phase 2: Gemini inference for Unknown language ===');

  const unknownQuery = { $or: [{ language: 'Unknown' }, { language: { $exists: false } }, { language: null }, { language: '' }] };
  let unknownBooks = await booksCol.find(unknownQuery)
    .project({ _id: 1, title: 1, display_title: 1, author: 1, published: 1 })
    .toArray();

  if (limit) unknownBooks = unknownBooks.slice(0, limit);
  console.log(`Found ${unknownBooks.length} books with Unknown/missing language`);

  if (unknownBooks.length === 0 || apiKeys.length === 0) {
    if (apiKeys.length === 0) console.log('No Gemini API key — skipping');
    await client.close();
    console.log('\nDone.');
    return;
  }

  // For each book, get a few page images + OCR sample
  console.log('Fetching page data...');
  for (const book of unknownBooks) {
    const bookPages = await pagesCol.find({ book_id: book._id })
      .project({ photo: 1, archived_photo: 1, photo_original: 1, 'ocr.data': 1, page_number: 1 })
      .sort({ page_number: 1 })
      .skip(2) // skip cover/blank
      .limit(PAGES_FOR_INFERENCE)
      .toArray();

    book.pageImages = bookPages
      .map(p => p.archived_photo || p.photo || p.photo_original)
      .filter(Boolean);

    // Get OCR sample for text-only fallback
    const ocrPage = bookPages.find(p => p.ocr?.data);
    book.ocrSample = ocrPage?.ocr?.data?.slice(0, 300) || '';
  }

  // Split into books with images (use vision) and without (text-only)
  const withImages = unknownBooks.filter(b => b.pageImages.length > 0);
  const withoutImages = unknownBooks.filter(b => b.pageImages.length === 0);

  let geminiParsed = 0;
  let geminiUpdates = [];

  // Process books WITH images (vision)
  if (withImages.length > 0) {
    console.log(`\nProcessing ${withImages.length} books with vision (${PAGES_FOR_INFERENCE} pages each)...`);

    // Vision batches need to be smaller due to image payload
    const visionBatchSize = 10;
    for (let i = 0; i < withImages.length; i += visionBatchSize) {
      const batch = withImages.slice(i, i + visionBatchSize);
      const results = await inferLanguagesWithGemini(batch);

      for (const book of batch) {
        const id = book._id.toString();
        if (results[id]) {
          geminiParsed++;
          geminiUpdates.push({
            id: book._id,
            language: results[id].language,
            confidence: results[id].confidence,
            source: 'gemini_vision'
          });
        }
      }

      const progress = Math.min(i + visionBatchSize, withImages.length);
      console.log(`  Vision: ${progress}/${withImages.length} (${geminiParsed} classified)`);
      if (i + visionBatchSize < withImages.length) await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Process books WITHOUT images (text-only)
  if (withoutImages.length > 0) {
    console.log(`\nProcessing ${withoutImages.length} books text-only...`);

    for (let i = 0; i < withoutImages.length; i += GEMINI_BATCH_SIZE) {
      const batch = withoutImages.slice(i, i + GEMINI_BATCH_SIZE);
      const results = await inferLanguagesTextOnly(batch);

      for (const book of batch) {
        const id = book._id.toString();
        if (results[id]) {
          geminiParsed++;
          geminiUpdates.push({
            id: book._id,
            language: results[id].language,
            confidence: results[id].confidence,
            source: 'gemini_text'
          });
        }
      }

      const progress = Math.min(i + GEMINI_BATCH_SIZE, withoutImages.length);
      console.log(`  Text: ${progress}/${withoutImages.length}`);
      if (i + GEMINI_BATCH_SIZE < withoutImages.length) await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\nGemini results: ${geminiParsed} classified out of ${unknownBooks.length}`);

  // Show distribution of inferred languages
  const langCounts = {};
  for (const u of geminiUpdates) {
    langCounts[u.language] = (langCounts[u.language] || 0) + 1;
  }
  console.log('\nInferred language distribution:');
  Object.entries(langCounts).sort((a, b) => b[1] - a[1]).forEach(([lang, count]) => {
    console.log(`  ${lang}: ${count}`);
  });

  // Show sample
  console.log('\nSample updates:');
  for (const u of geminiUpdates.slice(0, 10)) {
    const book = unknownBooks.find(b => b._id.equals(u.id));
    console.log(`  "${book.title?.slice(0, 60)}" → ${u.language} (${u.confidence}, ${u.source})`);
  }

  // Apply
  if (!dryRun && geminiUpdates.length > 0) {
    console.log(`\nWriting ${geminiUpdates.length} language updates...`);
    const bulkOps = geminiUpdates.map(u => ({
      updateOne: {
        filter: { _id: u.id },
        update: {
          $set: {
            language: u.language,
            language_source: u.source,
            language_confidence: u.confidence,
          }
        }
      }
    }));

    const result = await booksCol.bulkWrite(bulkOps, { ordered: false });
    console.log(`Modified: ${result.modifiedCount}`);
  }

  await client.close();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
