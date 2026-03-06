#!/usr/bin/env node
/**
 * Backfill first_translation assessment for books enriched before Feb 17 2026.
 *
 * These books have ai_metadata (language, categories, etc.) but no first_translation
 * field because it was added to the enrichment prompt on Feb 17.
 *
 * This script does a LIGHTWEIGHT assessment — reads first 25 OCR pages and asks
 * ONLY about first_translation. Does NOT re-run full enrichment.
 *
 * Usage:
 *   node _tmp-backfill-ft-stage1.mjs --dry-run          # Preview
 *   node _tmp-backfill-ft-stage1.mjs --apply             # Write to DB
 *   node _tmp-backfill-ft-stage1.mjs --apply --limit 50  # First 50
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';

const MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 5;
const DELAY_MS = 300;
const MAX_OCR_PAGES = 25;
const MAX_TEXT_PER_PAGE = 2000;

// ── Env ─────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const client = new GoogleGenerativeAI(API_KEY);

// ── Prompt ──────────────────────────────────────────────────────────

function buildPrompt(book, ocrSamples) {
  const ocrSection = ocrSamples.length > 0
    ? `\n\nHere is the OCR text from ${ocrSamples.length} pages of this book:\n\n` +
      ocrSamples.map(s => `--- Page ${s.pageNumber} ---\n${s.text}`).join('\n\n')
    : '\n\n(No OCR text available — classify based on metadata only.)';

  return `You are a rare books librarian and translation scholar.

Book metadata:
- Title: "${book.display_title || book.title || 'Unknown'}"
- Author: ${book.author || 'Unknown'}
- Language: ${book.language || book.ai_metadata?.language || 'Unknown'}
- Published: ${book.published || 'Unknown'}
${ocrSection}

Has this work EVER been translated into English? Consider academic publishers, specialist presses, older translations, PhD dissertations, journal translations, and partial translations.

Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English.

If the book IS already in English, set status to "not_applicable".

Respond with JSON only — no markdown fences:

{
  "first_translation": {
    "status": "<one of: confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences>",
    "known_translations": ["<any known English translations>"],
    "confidence": "<high, medium, or low>"
  }
}`;
}

// ── Core ────────────────────────────────────────────────────────────

async function assessBook(model, book, ocrSamples) {
  const prompt = buildPrompt(book, ocrSamples);
  const startTime = Date.now();

  let result;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err) {
      if (attempt < 2 && (err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET') || err.message?.includes('timed out'))) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  const durationMs = Date.now() - startTime;
  const response = result.response;
  const candidates = response.candidates || [];
  const allParts = candidates[0]?.content?.parts || [];
  const text = allParts.map(p => p.text || '').join('').trim() || response.text().trim();
  const usage = response.usageMetadata || {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('Failed to parse JSON');
  }

  return {
    first_translation: parsed.first_translation,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
    duration_ms: durationMs,
  };
}

function calculateCost(usage) {
  return (
    (usage.input_tokens / 1_000_000) * 0.15 +
    (usage.output_tokens / 1_000_000) * 0.60
  );
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 0;

  console.log('=== Backfill first_translation (Stage 1) ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL}`);
  if (limit) console.log(`Limit: ${limit}`);

  const mongo = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000 });
  await mongo.connect();
  const db = mongo.db(MONGODB_DB);

  // Find books with ai_metadata but no first_translation
  const query = {
    language: { $nin: ['English', 'english', null, ''] },
    'ai_metadata.enriched_at': { $exists: true },
    'ai_metadata.first_translation': { $exists: false },
  };

  const totalCount = await db.collection('books').countDocuments(query);
  console.log(`\nFound ${totalCount} books missing first_translation assessment`);

  const cursor = db.collection('books')
    .find(query, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, ai_metadata: 1, is_first_translation: 1,
      },
    })
    .sort({ pages_translated: -1 });

  if (limit) cursor.limit(limit);
  const books = await cursor.toArray();
  console.log(`Processing ${books.length} books\n`);

  const geminiModel = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  let processed = 0;
  let confirmedFirst = 0;
  let likelyFirst = 0;
  let hasTranslation = 0;
  let uncertain = 0;
  let notApplicable = 0;
  let errors = 0;
  let totalCost = 0;

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      // Fetch OCR pages
      const pages = await db.collection('pages')
        .find(
          { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } },
          { projection: { page_number: 1, 'ocr.data': 1 } },
        )
        .sort({ page_number: 1 })
        .limit(MAX_OCR_PAGES)
        .toArray();

      const ocrSamples = pages.map(p => ({
        pageNumber: p.page_number,
        text: (p.ocr?.data || '').substring(0, MAX_TEXT_PER_PAGE),
      }));

      if (ocrSamples.length < 3) {
        return { book, skip: true, reason: `Only ${ocrSamples.length} OCR pages` };
      }

      const result = await assessBook(geminiModel, book, ocrSamples);
      return { book, result };
    }));

    for (const r of results) {
      processed++;
      if (r.status === 'rejected') {
        errors++;
        console.log(`  [${processed}/${books.length}] FAIL: ${r.reason?.message || r.reason}`);
        continue;
      }

      const { book, result, skip, reason } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);

      if (skip) {
        console.log(`  [${processed}/${books.length}] SKIP  ${shortTitle} — ${reason}`);
        continue;
      }

      if (!result?.first_translation) {
        errors++;
        console.log(`  [${processed}/${books.length}] ERROR ${shortTitle} — no first_translation in response`);
        continue;
      }

      const ft = result.first_translation;
      const status = ft.status || 'uncertain';
      const cost = calculateCost(result.usage);
      totalCost += cost;

      const isFirst = ['confirmed_first', 'likely_first'].includes(status);

      // Tally
      if (status === 'confirmed_first') confirmedFirst++;
      else if (status === 'likely_first') likelyFirst++;
      else if (status === 'has_translation' || status === 'has_partial') hasTranslation++;
      else if (status === 'not_applicable') notApplicable++;
      else uncertain++;

      const icon = isFirst ? 'FIRST' : status === 'has_translation' ? 'HAS  ' : status === 'not_applicable' ? 'N/A  ' : 'UNCRT';
      console.log(`  [${processed}/${books.length}] ${icon} ${shortTitle} | ${status} (${ft.confidence}) $${cost.toFixed(4)}`);
      if (ft.reasoning) console.log(`         ${ft.reasoning.substring(0, 120)}`);

      // Write to DB
      if (!dryRun) {
        await db.collection('books').updateOne(
          { id: book.id },
          {
            $set: {
              'ai_metadata.first_translation': ft,
              is_first_translation: isFirst,
              updated_at: new Date(),
            },
          },
        );

        // Log to gemini_usage
        await db.collection('gemini_usage').insertOne({
          timestamp: new Date(),
          type: 'other',
          mode: 'realtime',
          model: MODEL,
          book_id: book.id,
          book_title: book.display_title || book.title,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cost_usd: cost,
          status: 'success',
          duration_ms: result.duration_ms,
          endpoint: 'script/backfill-first-translation-stage1',
        });
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Confirmed first: ${confirmedFirst}`);
  console.log(`Likely first: ${likelyFirst}`);
  console.log(`Has translation: ${hasTranslation}`);
  console.log(`Uncertain: ${uncertain}`);
  console.log(`Not applicable: ${notApplicable}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB)');

  await mongo.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
