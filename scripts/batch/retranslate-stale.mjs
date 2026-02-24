#!/usr/bin/env node
/**
 * Retranslate pages with stale translations.
 *
 * Finds pages where OCR was done with gemini-3-flash-preview but translation
 * was done with an older model, and submits Gemini Batch API jobs to retranslate.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch/retranslate-stale.mjs [--dry-run] [--limit=N] [--book-id=ID]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const BOOK_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : Infinity;
const BOOK_ID_ARG = process.argv.find(a => a.startsWith('--book-id='));
const SINGLE_BOOK_ID = BOOK_ID_ARG ? BOOK_ID_ARG.split('=')[1] : null;

const CURRENT_MODEL = 'gemini-3-flash-preview';
const BATCH_MODEL = 'gemini-3-flash-preview';
const MAX_PAGES_PER_BATCH = 300;

// Skip page types that don't need translation
const SKIP_PAGE_TYPES = ['blank', 'illustration', 'cover', 'title_page', 'colophon'];

// API keys for batch submission (prefer KEY_2 for separate quota)
const BATCH_KEYS = [
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
].filter(Boolean);
const UNIQUE_KEYS = [...new Set(BATCH_KEYS)];

// English modernization prompt (simplified — real one fetched from DB)
const ENGLISH_MODERNIZATION_PROMPT = `You are a specialist in Early Modern English literature. Modernize the following Early Modern English text into clear, readable Modern English.

Rules:
- Update archaic spelling, grammar, and vocabulary to modern equivalents
- Preserve the author's meaning, tone, and style as closely as possible
- Keep proper nouns unchanged
- Maintain paragraph structure
- Do not add commentary or notes — output only the modernized text`;

async function getTranslationPrompt(db, language) {
  const isEnglish = language?.toLowerCase() === 'english';

  if (isEnglish) {
    return { text: ENGLISH_MODERNIZATION_PROMPT, isEnglish: true };
  }

  // Fetch from prompts collection
  const prompt = await db.collection('prompts').findOne({
    type: 'translation',
    is_default: true,
  });

  if (prompt?.text) {
    const filled = prompt.text
      .replace(/\{sourceLanguage\}/g, language || 'the original language')
      .replace(/\{targetLanguage\}/g, 'English');
    return { text: filled, isEnglish: false };
  }

  // Fallback
  return {
    text: `Translate the following ${language || ''} text into English. Preserve the original meaning and scholarly tone. Output only the translation.`,
    isEnglish: false,
  };
}

async function submitBatch(batchRequests, displayName, keyIndex = 0) {
  if (keyIndex >= UNIQUE_KEYS.length) {
    throw new Error('All API keys exhausted');
  }

  const client = new GoogleGenAI({ apiKey: UNIQUE_KEYS[keyIndex] });

  try {
    const batchJob = await client.batches.create({
      model: BATCH_MODEL,
      src: batchRequests.map(r => ({
        ...r.request,
        metadata: { key: r.key },
      })),
      config: { displayName },
    });
    return { job: batchJob, keyIndex };
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
      console.warn(`  Key ${keyIndex} quota exhausted, trying next...`);
      return submitBatch(batchRequests, displayName, keyIndex + 1);
    }
    throw err;
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Source .env.production.local first.');
    process.exit(1);
  }

  if (UNIQUE_KEYS.length === 0) {
    console.error('No Gemini API keys found.');
    process.exit(1);
  }

  console.log(`Keys available: ${UNIQUE_KEYS.length}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (SINGLE_BOOK_ID) console.log(`Single book: ${SINGLE_BOOK_ID}`);
  if (BOOK_LIMIT < Infinity) console.log(`Book limit: ${BOOK_LIMIT}`);
  console.log();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Find pages with recent OCR but stale translation
  const matchFilter = {
    'ocr.data': { $exists: true, $nin: [null, ''] },
    'ocr.model': CURRENT_MODEL,
    'translation.data': { $exists: true, $nin: [null, ''] },
    'translation.model': { $ne: CURRENT_MODEL },
  };

  if (SINGLE_BOOK_ID) {
    matchFilter.book_id = SINGLE_BOOK_ID;
  }

  // Group by book
  const bookGroups = await db.collection('pages').aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$book_id',
        stale_count: { $sum: 1 },
        models: { $addToSet: '$translation.model' },
      }
    },
    { $sort: { stale_count: -1 } },
    ...(BOOK_LIMIT < Infinity ? [{ $limit: BOOK_LIMIT }] : []),
  ]).toArray();

  console.log(`Found ${bookGroups.length} books with stale translations`);
  const totalPages = bookGroups.reduce((s, b) => s + b.stale_count, 0);
  console.log(`Total stale pages: ${totalPages}`);
  console.log(`Estimated cost (batch): ~$${(totalPages * 0.0011).toFixed(2)}`);
  console.log();

  let totalSubmitted = 0;
  let totalJobs = 0;
  let failedBooks = [];

  for (const group of bookGroups) {
    const bookId = group._id;
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      console.warn(`Book ${bookId} not found, skipping`);
      continue;
    }

    const language = book.language || 'Latin';
    const promptInfo = await getTranslationPrompt(db, language);

    // Fetch stale pages for this book
    const stalePages = await db.collection('pages')
      .find({
        ...matchFilter,
        book_id: bookId,
        page_type: { $nin: SKIP_PAGE_TYPES },
      })
      .sort({ page_number: 1 })
      .toArray();

    if (stalePages.length === 0) continue;

    console.log(`${book.title || bookId} (${language})`);
    console.log(`  ${stalePages.length} stale pages, old models: ${group.models.join(', ')}`);

    if (DRY_RUN) {
      totalSubmitted += stalePages.length;
      continue;
    }

    // Split into batches if needed
    const batches = [];
    for (let i = 0; i < stalePages.length; i += MAX_PAGES_PER_BATCH) {
      batches.push(stalePages.slice(i, i + MAX_PAGES_PER_BATCH));
    }

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const batchRequests = [];

      for (const page of batch) {
        const ocrText = page.ocr?.data;
        if (!ocrText) continue;

        const prompt = promptInfo.text + (promptInfo.isEnglish
          ? `\n\n**Text to modernize:**\n${ocrText}`
          : `\n\n**Text to translate:**\n${ocrText}`);

        batchRequests.push({
          key: page.id,
          request: {
            contents: [{
              parts: [{ text: prompt }],
              role: 'user',
            }],
            config: {
              temperature: 0.1,
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        });
      }

      if (batchRequests.length === 0) continue;

      const displayName = `retranslate-stale-${bookId}-${bi}-${Date.now()}`;

      try {
        const { job } = await submitBatch(batchRequests, displayName);

        // Record in batch_jobs
        await db.collection('batch_jobs').insertOne({
          job_name: job.name,
          book_id: bookId,
          type: 'translation',
          model: BATCH_MODEL,
          source_language: language,
          target_language: 'English',
          force: true,
          prompt_version: 'v5.2026-02',
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          status: job.state,
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Log to gemini_usage
        await db.collection('gemini_usage').insertOne({
          type: 'translate',
          mode: 'batch',
          model: BATCH_MODEL,
          book_id: bookId,
          book_title: book.title,
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          batch_job_id: job.name,
          gemini_job_name: job.name,
          input_tokens: 0,
          output_tokens: 0,
          status: 'submitted',
          endpoint: 'retranslate-stale.mjs',
          timestamp: new Date(),
        });

        totalSubmitted += batchRequests.length;
        totalJobs++;
        console.log(`  Batch ${bi + 1}/${batches.length}: ${batchRequests.length} pages → ${job.name} (${job.state})`);
      } catch (err) {
        console.error(`  FAILED batch ${bi + 1}: ${err.message}`);
        failedBooks.push({ bookId, error: err.message });
        break; // If one batch fails for a book, skip remaining batches
      }
    }
  }

  console.log();
  console.log('=== Summary ===');
  console.log(`Books processed: ${bookGroups.length}`);
  console.log(`Pages submitted: ${totalSubmitted}`);
  console.log(`Batch jobs created: ${totalJobs}`);
  if (failedBooks.length > 0) {
    console.log(`Failed books: ${failedBooks.length}`);
    failedBooks.forEach(f => console.log(`  ${f.bookId}: ${f.error}`));
  }
  console.log();
  console.log('Results will be collected automatically by the process-batches cron (every 2h).');

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
