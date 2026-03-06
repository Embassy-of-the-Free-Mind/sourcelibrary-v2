#!/usr/bin/env node
/**
 * Model comparison test: gemini-3-flash-preview vs gemini-3.1-flash-lite
 *
 * Picks diverse sample pages, runs OCR through both models,
 * then outputs results for evaluation.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node _tmp-model-comparison.mjs
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import fs from 'fs';

const MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'];
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Fetch the current OCR prompt from DB
const promptDoc = await db.collection('prompts').findOne({ type: 'ocr', is_default: true });
const ocrPrompt = promptDoc?.content || promptDoc?.text || '';
if (!ocrPrompt) { console.error('No OCR prompt found'); process.exit(1); }
console.log(`Using prompt: "${promptDoc.name}" v${promptDoc.version} (${ocrPrompt.length} chars)\n`);

// Pick diverse sample pages:
// - 3 Latin (dense text, different books)
// - 2 German Fraktur
// - 2 English (Early Modern)
// - 1 illustration-heavy
// - 1 table of contents
// - 1 multi-column
// - 1 Hebrew/Arabic (if available)
// Strategy: find books by language, pick mid-book pages (not blank first pages)

async function pickPages() {
  const samples = [];

  // Helper: pick a random mid-book page with an image
  async function pickFromBook(bookQuery, label, count = 1) {
    const books = await db.collection('books').find(bookQuery)
      .sort({ read_count: -1 })
      .limit(10)
      .project({ id: 1, title: 1, language: 1, original_language: 1, slug: 1 })
      .toArray();

    for (const book of books) {
      if (samples.filter(s => s.label === label).length >= count) break;

      const pages = await db.collection('pages').find({
        book_id: book.id,
        page_number: { $gte: 10 }, // skip first pages
        $or: [
          { archived_photo: { $exists: true, $ne: null } },
          { photo: { $exists: true, $ne: null } },
        ],
        'ocr.data': { $exists: true }, // has existing OCR to compare against
      })
        .sort({ page_number: 1 })
        .limit(20)
        .project({ id: 1, page_number: 1, book_id: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, 'ocr.data': 1, page_type: 1, columns: 1 })
        .toArray();

      // Pick from middle of the set
      if (pages.length > 5) {
        const mid = Math.floor(pages.length / 2);
        const page = pages[mid];
        const imageUrl = page.cropped_photo || page.archived_photo || page.photo || page.photo_original;
        if (imageUrl) {
          samples.push({
            label,
            bookTitle: book.title?.substring(0, 60),
            bookSlug: book.slug,
            language: book.language || book.original_language,
            pageNumber: page.page_number,
            pageId: page.id,
            imageUrl,
            existingOcr: page.ocr?.data?.substring(0, 500),
            pageType: page.page_type,
            columns: page.columns,
          });
        }
      }
    }
  }

  // Latin texts — popular ones
  await pickFromBook({ $or: [{ language: 'Latin' }, { original_language: 'Latin' }], pages_count: { $gt: 50 } }, 'latin-dense', 3);

  // German Fraktur
  await pickFromBook({ $or: [{ language: 'German' }, { original_language: 'German' }], pages_count: { $gt: 50 } }, 'german-fraktur', 2);

  // English Early Modern
  await pickFromBook({ $or: [{ language: 'English' }, { original_language: 'English' }], year: { $lt: 1700 }, pages_count: { $gt: 50 } }, 'english-early-modern', 2);

  // Multi-column (from pages with columns >= 2)
  const multiColPages = await db.collection('pages').find({
    columns: { $gte: 2 },
    'ocr.data': { $exists: true },
    archived_photo: { $exists: true },
  }).limit(5).toArray();

  for (const page of multiColPages.slice(0, 1)) {
    const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { title: 1, slug: 1, language: 1, original_language: 1 } });
    samples.push({
      label: 'multi-column',
      bookTitle: book?.title?.substring(0, 60),
      bookSlug: book?.slug,
      language: book?.language || book?.original_language,
      pageNumber: page.page_number,
      pageId: page.id,
      imageUrl: page.cropped_photo || page.archived_photo || page.photo,
      existingOcr: page.ocr?.data?.substring(0, 500),
      pageType: page.page_type,
      columns: page.columns,
    });
  }

  // Illustration page
  const illustrationPages = await db.collection('pages').find({
    page_type: { $in: ['illustration', 'diagram', 'emblem'] },
    'ocr.data': { $exists: true },
    archived_photo: { $exists: true },
  }).limit(5).toArray();

  for (const page of illustrationPages.slice(0, 1)) {
    const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { title: 1, slug: 1, language: 1, original_language: 1 } });
    samples.push({
      label: 'illustration',
      bookTitle: book?.title?.substring(0, 60),
      bookSlug: book?.slug,
      language: book?.language || book?.original_language,
      pageNumber: page.page_number,
      pageId: page.id,
      imageUrl: page.cropped_photo || page.archived_photo || page.photo,
      existingOcr: page.ocr?.data?.substring(0, 500),
      pageType: page.page_type,
      columns: page.columns,
    });
  }

  // Table of contents
  const tocPages = await db.collection('pages').find({
    page_type: 'table_of_contents',
    'ocr.data': { $exists: true },
    archived_photo: { $exists: true },
  }).limit(5).toArray();

  for (const page of tocPages.slice(0, 1)) {
    const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { title: 1, slug: 1, language: 1, original_language: 1 } });
    samples.push({
      label: 'table-of-contents',
      bookTitle: book?.title?.substring(0, 60),
      bookSlug: book?.slug,
      language: book?.language || book?.original_language,
      pageNumber: page.page_number,
      pageId: page.id,
      imageUrl: page.cropped_photo || page.archived_photo || page.photo,
      existingOcr: page.ocr?.data?.substring(0, 500),
      pageType: page.page_type,
      columns: page.columns,
    });
  }

  // Hebrew or Arabic
  await pickFromBook({ $or: [{ language: 'Hebrew' }, { language: 'Arabic' }, { original_language: 'Hebrew' }, { original_language: 'Arabic' }] }, 'hebrew-arabic', 1);

  return samples;
}

async function fetchImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const mimeType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
  return { buffer, mimeType };
}

async function runOcr(imageBuffer, mimeType, modelId) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: modelId });
  const base64Image = imageBuffer.toString('base64');

  const start = Date.now();
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: ocrPrompt },
        { inlineData: { mimeType, data: base64Image } },
      ],
    }],
    safetySettings: SAFETY_SETTINGS,
  });
  const durationMs = Date.now() - start;

  const usage = result.response.usageMetadata;
  return {
    text: result.response.text(),
    inputTokens: usage?.promptTokenCount || 0,
    outputTokens: usage?.candidatesTokenCount || 0,
    durationMs,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log('Picking diverse sample pages...');
const samples = await pickPages();
console.log(`Selected ${samples.length} pages:\n`);

for (const s of samples) {
  console.log(`  [${s.label}] ${s.bookTitle} — p${s.pageNumber} (${s.language})`);
}
console.log('');

const results = [];

for (const sample of samples) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[${sample.label}] ${sample.bookTitle} — page ${sample.pageNumber} (${sample.language})`);
  console.log(`Image: ${sample.imageUrl.substring(0, 80)}...`);
  console.log(`${'='.repeat(70)}`);

  let imageBuffer, mimeType;
  try {
    ({ buffer: imageBuffer, mimeType } = await fetchImage(sample.imageUrl));
    console.log(`Image fetched: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.log(`SKIP — image fetch failed: ${err.message}`);
    continue;
  }

  const modelResults = {};

  for (const modelId of MODELS) {
    console.log(`\n  Running ${modelId}...`);
    try {
      const result = await runOcr(imageBuffer, mimeType, modelId);
      modelResults[modelId] = result;
      console.log(`  Done: ${result.outputTokens} tokens, ${result.durationMs}ms, ${result.text.length} chars`);
    } catch (err) {
      console.log(`  FAILED: ${err.message?.substring(0, 80)}`);
      modelResults[modelId] = { error: err.message };
    }
  }

  results.push({ sample, modelResults });
}

// Write full results to file for evaluation
const output = {
  timestamp: new Date().toISOString(),
  prompt: promptDoc.name + ' v' + promptDoc.version,
  models: MODELS,
  pages: results.map(r => ({
    label: r.sample.label,
    book: r.sample.bookTitle,
    slug: r.sample.bookSlug,
    language: r.sample.language,
    pageNumber: r.sample.pageNumber,
    pageId: r.sample.pageId,
    imageUrl: r.sample.imageUrl,
    existingOcr: r.sample.existingOcr,
    pageType: r.sample.pageType,
    columns: r.sample.columns,
    results: Object.fromEntries(
      Object.entries(r.modelResults).map(([model, res]) => [
        model,
        res.error
          ? { error: res.error }
          : {
              text: res.text,
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
              durationMs: res.durationMs,
              charCount: res.text.length,
            },
      ])
    ),
  })),
};

const outPath = '/tmp/model-comparison-results.json';
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\n\nResults written to ${outPath}`);

// Print summary table
console.log(`\n${'='.repeat(70)}`);
console.log('SUMMARY');
console.log(`${'='.repeat(70)}`);
console.log(`${'Page'.padEnd(35)} ${'Model'.padEnd(30)} ${'Tokens'.padStart(7)} ${'Time'.padStart(7)} ${'Chars'.padStart(7)}`);
for (const r of results) {
  for (const modelId of MODELS) {
    const res = r.modelResults[modelId];
    if (res?.error) {
      console.log(`${r.sample.label.padEnd(35)} ${modelId.padEnd(30)} ${'ERROR'.padStart(7)}`);
    } else if (res) {
      console.log(`${r.sample.label.padEnd(35)} ${modelId.padEnd(30)} ${String(res.outputTokens).padStart(7)} ${(res.durationMs + 'ms').padStart(7)} ${String(res.text.length).padStart(7)}`);
    }
  }
}

await client.close();
console.log('\nDone. Review /tmp/model-comparison-results.json for full OCR text comparison.');
