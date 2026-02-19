#!/usr/bin/env node
/**
 * Batch extract chapters/TOC for books with OCR
 *
 * Replicates the logic from src/lib/chapter-extraction.ts:
 *   1. Extract raw markdown headings from OCR text
 *   2. Identify TOC pages by page_type or keyword heuristics
 *   3. Call Gemini to filter real chapters from noise
 *   4. Validate and save chapters to book document
 *
 * Usage:
 *   node scripts/batch-extract-chapters.mjs --dry-run            # Preview
 *   node scripts/batch-extract-chapters.mjs --apply               # Process
 *   node scripts/batch-extract-chapters.mjs --apply --limit 200   # First 200
 *   node scripts/batch-extract-chapters.mjs --apply --book "Fludd" # Specific book
 *   node scripts/batch-extract-chapters.mjs --apply --force        # Re-extract existing
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────

const MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 10;  // Chapter extraction is lightweight — one API call per book
const DELAY_BETWEEN_BATCHES_MS = 500;
const MIN_OCR_PAGES = 10; // Skip books with fewer OCR pages

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

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
            (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        env[match[1].trim()] = value;
      }
    }
  } catch { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// API key rotation
function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  }
  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY configured'); process.exit(1); }
let keyIndex = 0;

function getModel() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  const client = new GoogleGenerativeAI(key);
  return client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { temperature: 0.1, maxOutputTokens: 65536 },
  });
}

// ── Cost tracking ────────────────────────────────────────────────────

const INPUT_COST_PER_1M = 0.50;
const OUTPUT_COST_PER_1M = 3.00;

function calculateCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
         (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;
}

// ── Heading extraction ──────────────────────────────────────────────

function extractRawHeadings(ocrText, pageNumber) {
  const headings = [];
  const lines = ocrText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let title = headingMatch[2].trim();
      title = title.replace(/^->/, '').replace(/<-$/, '').trim();
      title = title.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      if (title.length < 3) continue;
      headings.push({ title, level, pageNumber });
    }
  }

  return headings;
}

// ── Prompt building ─────────────────────────────────────────────────

function buildExtractionPrompt(bookTitle, author, language, pageCount, rawHeadings, tocPages) {
  let prompt = `You are analyzing the structure of a digitized historical book to extract its table of contents.

**Book:** ${bookTitle}
**Author:** ${author}
**Language:** ${language}
**Total pages:** ${pageCount}

`;

  if (tocPages.length > 0) {
    prompt += `## Table of Contents Pages\n\nThe following pages appear to contain a printed table of contents:\n\n`;
    for (const toc of tocPages) {
      prompt += `### Page ${toc.pageNumber}\n\`\`\`\n${toc.text.slice(0, 3000)}\n\`\`\`\n\n`;
    }
  }

  prompt += `## Raw OCR Headings\n\nThe OCR system marked ${rawHeadings.length} lines as headings. Most are noise (title pages, dedications, running headers, captions, centered text). Your job is to identify which ones are real structural divisions of the book.\n\n`;

  // Group headings by page
  const byPage = new Map();
  for (const h of rawHeadings) {
    const arr = byPage.get(h.pageNumber) || [];
    arr.push(h);
    byPage.set(h.pageNumber, arr);
  }

  for (const [pageNum, pageHeadings] of byPage) {
    prompt += `p.${pageNum}: ${pageHeadings.map(h => `${'#'.repeat(h.level)} ${h.title}`).join(' | ')}\n`;
  }

  prompt += `

## Instructions

Return ONLY the real structural chapters/sections of this book as a JSON array. Each entry needs:
- "title": Clean chapter title in the original language (fix obvious OCR errors if any)
- "titleEn": English translation of the chapter title (concise, natural English). If the book is already in English, omit this field.
- "pageNumber": The page number where this chapter starts
- "level": Hierarchy level (1 = top-level division like Tractatus/Part/Book, 2 = major chapter like Liber/Section, 3 = sub-chapter like Caput/Chapter)

Guidelines:
- Look for the book's actual organizational structure (Parts, Books, Chapters, Sections, Tractatus, Liber, Caput, etc.)
- SKIP: title pages, dedications, epistles to the reader, indices/indexes, running headers, image captions, printer colophons
- SKIP: fragmentary text, continuation lines, single words that aren't chapter titles
- INCLUDE: prefaces/prologues if they are labeled sections the reader would navigate to
- A typical book has 5-50 chapters. If you find more than 80, you're probably including too much noise.
- If the book has a clear hierarchy (e.g., Tractatus > Liber > Caput), preserve it with levels 1/2/3
- If a heading appears to be a table of contents entry listing a chapter, include the chapter, not the TOC entry
- Merge multi-line titles that were split across headings on the same page
- For titleEn: preserve structural labels (Tractatus → Treatise, Liber → Book, Caput → Chapter, Pars → Part)

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"title": "...", "titleEn": "...", "pageNumber": N, "level": N}, ...]

If the book has no discernible chapter structure, return an empty array: []`;

  return prompt;
}

// ── Process one book ────────────────────────────────────────────────

async function processBook(db, book) {
  const bookTitle = book.display_title || book.title;
  const bookAuthor = book.author || 'Unknown';
  const bookLanguage = book.language || book.original_language || 'Unknown';

  // Get all pages with OCR
  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 } }
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length < MIN_OCR_PAGES) {
    return { skipped: true, reason: `only ${pages.length} OCR pages` };
  }

  // Extract raw headings
  const rawHeadings = [];
  for (const page of pages) {
    rawHeadings.push(...extractRawHeadings(page.ocr?.data || '', page.page_number));
  }

  if (rawHeadings.length === 0) {
    // No headings found — save empty chapters to avoid re-processing
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { chapters: [], chapters_extracted_at: new Date() } }
    );
    return { chapters: 0, rawHeadings: 0, reason: 'no headings found' };
  }

  // Identify TOC pages
  const tocPages = [];
  for (const page of pages) {
    const ocrText = (page.ocr?.data || '').toLowerCase();
    const pageType = page.page_type;
    const isTocByType = pageType === 'table_of_contents' || pageType === 'index';
    const isTocByContent = /\b(tabula|index|contents|sommaire|inhalt|capitum|capitulorum)\b/i.test(ocrText)
      && page.page_number <= Math.min(30, pages.length * 0.1);
    if (isTocByType || isTocByContent) {
      tocPages.push({ pageNumber: page.page_number, text: page.ocr?.data || '' });
    }
  }

  // Cap headings to avoid massive prompts on very large books
  const cappedHeadings = rawHeadings.length > 500 ? rawHeadings.slice(0, 500) : rawHeadings;

  // Call Gemini
  const model = getModel();
  const prompt = buildExtractionPrompt(
    bookTitle, bookAuthor, bookLanguage,
    pages.length, cappedHeadings, tocPages.slice(0, 5)
  );

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.text();
  const usage = response.usageMetadata;

  const inputTokens = usage?.promptTokenCount || 0;
  const outputTokens = usage?.candidatesTokenCount || 0;

  // Parse response
  let aiChapters;
  try {
    const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    aiChapters = JSON.parse(cleaned);
  } catch {
    // Try to recover truncated JSON by finding the last complete object
    try {
      const cleaned = responseText.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = cleaned.slice(0, lastBrace + 1) + ']';
        aiChapters = JSON.parse(truncated);
      } else {
        throw new Error('no recoverable JSON');
      }
    } catch {
      throw new Error(`Unparseable response: ${responseText.slice(0, 200)}`);
    }
  }

  // Build page ID mapping
  const pageByNumber = new Map();
  for (const page of pages) {
    pageByNumber.set(page.page_number, page.id);
  }

  // Validate chapters
  const chapters = [];
  for (const ch of aiChapters) {
    if (!ch.title || !ch.pageNumber) continue;
    let pageId = pageByNumber.get(ch.pageNumber);
    if (!pageId) {
      for (let offset = 1; offset <= 2; offset++) {
        pageId = pageByNumber.get(ch.pageNumber + offset) || pageByNumber.get(ch.pageNumber - offset);
        if (pageId) break;
      }
    }
    if (!pageId) continue;

    const chapter = {
      title: ch.title,
      pageId,
      pageNumber: ch.pageNumber,
      level: Math.min(Math.max(ch.level || 1, 1), 3),
    };
    if (ch.titleEn) chapter.titleEn = ch.titleEn;
    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.pageNumber - b.pageNumber);

  // Save to book
  await db.collection('books').updateOne(
    { id: book.id },
    { $set: { chapters, chapters_extracted_at: new Date() } }
  );

  // Log usage
  const cost = calculateCost(inputTokens, outputTokens);
  await db.collection('gemini_usage').insertOne({
    timestamp: new Date(),
    type: 'extract_chapters',
    mode: 'realtime',
    model: MODEL,
    book_id: book.id,
    book_title: bookTitle,
    page_count: pages.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
    status: 'success',
    endpoint: 'script/batch-extract-chapters',
  });

  return { chapters: chapters.length, rawHeadings: rawHeadings.length, tocPages: tocPages.length, cost, tokens: { input: inputTokens, output: outputTokens } };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const force = args.includes('--force');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 500;
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  console.log(`=== Batch Chapter Extraction ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL}`);
  console.log(`API keys: ${apiKeys.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Limit: ${limit}\n`);

  const mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Find books needing chapter extraction
  const filter = { pages_ocr: { $gte: MIN_OCR_PAGES } };
  if (!force) {
    filter.chapters_extracted_at = { $exists: false };
  }
  if (specificBook) {
    filter.$or = [
      { title: { $regex: specificBook, $options: 'i' } },
      { author: { $regex: specificBook, $options: 'i' } },
      { id: specificBook },
    ];
  }

  const books = await db.collection('books')
    .find(filter)
    .sort({ pages_ocr: -1 }) // Biggest books first
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books to process\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let totalCost = 0;
  let totalChapters = 0;
  let emptyBooks = 0;

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);
      const idx = books.indexOf(book) + 1;

      if (dryRun) {
        console.log(`  [${idx}/${books.length}] WOULD process: ${shortTitle} (${book.pages_ocr || 0} OCR pages)`);
        return { book, dryRun: true };
      }

      try {
        const result = await processBook(db, book);

        if (result.skipped) {
          console.log(`  [${idx}/${books.length}] SKIP ${shortTitle} — ${result.reason}`);
          return { book, skipped: true };
        }

        if (result.chapters === 0) {
          console.log(`  [${idx}/${books.length}] EMPTY ${shortTitle} — ${result.rawHeadings} headings, ${result.reason || 'no chapters found'}`);
          return { book, result, empty: true };
        }

        console.log(`  [${idx}/${books.length}] OK ${shortTitle} — ${result.chapters} chapters (from ${result.rawHeadings} headings, ${result.tocPages} TOC pages) | $${result.cost.toFixed(4)}`);
        return { book, result };
      } catch (err) {
        console.log(`  [${idx}/${books.length}] FAIL ${shortTitle} — ${err.message}`);
        return { book, error: err.message };
      }
    }));

    for (const r of results) {
      processed++;
      if (r.status === 'rejected') { failed++; continue; }
      const { result, error, skipped: wasSkipped, empty, dryRun: wasDryRun } = r.value;
      if (wasDryRun) continue;
      if (wasSkipped) { skipped++; continue; }
      if (error) { failed++; continue; }
      if (empty) { emptyBooks++; succeeded++; continue; }
      if (result) {
        succeeded++;
        totalCost += result.cost || 0;
        totalChapters += result.chapters || 0;
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded} (${emptyBooks} with no chapters found)`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total chapters extracted: ${totalChapters}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost/book: $${succeeded > 0 ? (totalCost / succeeded).toFixed(4) : '0'}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB.)');
  await mongoClient.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
