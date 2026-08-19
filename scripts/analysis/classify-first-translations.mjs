#!/usr/bin/env node
/**
 * Classify which books in Source Library are likely first-ever English translations.
 *
 * Uses Gemini to assess each book based on title, author, year, and language.
 * Results stored in MongoDB `translation_classification` collection.
 *
 * Usage:
 *   node scripts/analysis/classify-first-translations.mjs [--dry-run] [--batch-size=25] [--limit=100] [--offset=0]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSize = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '25');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');
const skipExisting = !args.includes('--force');

const GEMINI_MODEL = 'gemini-3-flash-preview';
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

const CLASSIFICATION_PROMPT = `You are a scholarly bibliographer specializing in the history of English translations of European, Middle Eastern, and Asian texts.

For each book listed below, assess whether a PUBLISHED English translation of this specific work exists. Consider:

1. **The specific work** — not just any work by the same author, but THIS specific text/treatise/edition
2. **Published translations** — academic, commercial, or scholarly. Self-published modern translations count. Blog/website translations do NOT count unless they're well-known scholarly resources.
3. **Partial translations count** — if major portions have been translated in anthologies or collected works, note that.
4. **The distinction between famous and obscure** — e.g., Agrippa's "Occult Philosophy" has a famous English translation, but his minor treatises may not.

For EACH book, respond with a JSON object:
{
  "book_index": <number>,
  "classification": "never_translated" | "previously_translated" | "partially_translated" | "uncertain",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<1-2 sentences explaining your assessment>",
  "known_translation": "<if previously_translated, cite the translation (translator, year, publisher) if known, otherwise null>"
}

Important guidelines:
- "never_translated" = No published English translation of this specific work exists to your knowledge
- "previously_translated" = A published English translation exists (give details if you can)
- "partially_translated" = Parts appear in English anthologies/collections but no complete standalone translation
- "uncertain" = You genuinely cannot determine (common for very obscure works)
- Be CONSERVATIVE with "never_translated" — if a major author's collected works were translated, individual treatises within them count as translated
- For multi-volume works (e.g. "Theatrum Chemicum Vol III"), assess THAT specific volume
- Many alchemical/hermetic texts were translated in the 19th-20th century revival period — consider Waite, Atwood, etc.

Respond ONLY with a JSON array of objects, one per book. No markdown, no explanation outside the JSON.`;

async function classifyBatch(ai, books, batchNum) {
  const bookList = books.map((b, i) => {
    const title = b.display_title || b.title || 'Untitled';
    const author = b.author || 'Unknown';
    const year = b.year || b.published || 'Unknown';
    const lang = b.language || 'Unknown';
    const cats = (b.categories || []).join(', ');
    return `${i + 1}. "${title}" by ${author} (${year}, ${lang})${cats ? ` [${cats}]` : ''}`;
  }).join('\n');

  const prompt = `${CLASSIFICATION_PROMPT}\n\nBooks to classify:\n${bookList}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      }
    });

    let text = response.text.trim();
    // Strip markdown code fences if present
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const results = JSON.parse(text);
    if (!Array.isArray(results)) throw new Error('Response is not an array');
    return results;
  } catch (err) {
    console.error(`  Batch ${batchNum} error:`, err.message);
    // Try to salvage partial results
    return null;
  }
}

async function main() {
  console.log('=== First Translation Classifier ===');
  console.log(`Model: ${GEMINI_MODEL}, Batch size: ${batchSize}, Dry run: ${dryRun}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get candidate books — all non-English books without is_first_translation set
  const pipelineOnly = args.includes('--pipeline');
  const query = {
    language: { $nin: ['English', 'english', 'Unknown', null] },
    is_first_translation: { $exists: false },
    ...(pipelineOnly ? { 'pipeline_auto.status': { $exists: true } } : {}),
  };

  let books = await db.collection('books').find(query, {
    projection: { _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, published: 1, categories: 1, pages_count: 1, pages_translated: 1 }
  }).sort({ title: 1 }).toArray();

  console.log(`Total candidates: ${books.length}`);

  // Skip already classified
  if (skipExisting) {
    const existing = await db.collection('translation_classification').find({}, { projection: { book_id: 1 } }).toArray();
    const existingIds = new Set(existing.map(e => e.book_id));
    const before = books.length;
    books = books.filter(b => !existingIds.has(b.id));
    if (before !== books.length) {
      console.log(`Skipping ${before - books.length} already classified (use --force to reclassify)`);
    }
  }

  // Apply offset/limit
  if (offset > 0) books = books.slice(offset);
  if (limit > 0) books = books.slice(0, limit);
  console.log(`Processing: ${books.length} books in ${Math.ceil(books.length / batchSize)} batches\n`);

  if (dryRun) {
    console.log('DRY RUN — first batch would be:');
    books.slice(0, batchSize).forEach((b, i) => {
      console.log(`  ${i + 1}. [${b.language}] ${(b.display_title || b.title || '').substring(0, 70)} — ${(b.author || 'Unknown').substring(0, 30)}`);
    });
    await client.close();
    return;
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const collection = db.collection('translation_classification');

  // Ensure index
  await collection.createIndex({ book_id: 1 }, { unique: true });
  await collection.createIndex({ classification: 1 });
  await collection.createIndex({ confidence: -1 });

  let totalProcessed = 0;
  let stats = { never_translated: 0, previously_translated: 0, partially_translated: 0, uncertain: 0, errors: 0 };

  for (let i = 0; i < books.length; i += batchSize) {
    const batch = books.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(books.length / batchSize);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} books)...`);

    const results = await classifyBatch(ai, batch, batchNum);

    if (!results) {
      stats.errors += batch.length;
      console.log(`  FAILED — skipping batch`);
      continue;
    }

    // Save results
    const ops = [];
    for (const result of results) {
      const bookIdx = (result.book_index || result.bookIndex || 0) - 1;
      const book = batch[bookIdx];
      if (!book) {
        console.log(`  Warning: no book at index ${result.book_index}`);
        continue;
      }

      const doc = {
        book_id: book.id,
        title: book.display_title || book.title,
        author: book.author,
        year: book.year || book.published,
        language: book.language,
        classification: result.classification,
        confidence: result.confidence,
        reasoning: result.reasoning,
        known_translation: result.known_translation || null,
        model: GEMINI_MODEL,
        classified_at: new Date()
      };

      ops.push({
        updateOne: {
          filter: { book_id: book.id },
          update: { $set: doc },
          upsert: true
        }
      });

      stats[result.classification] = (stats[result.classification] || 0) + 1;
      totalProcessed++;
    }

    if (ops.length > 0) {
      await collection.bulkWrite(ops);
      // Deliberately does NOT write books.is_first_translation. An unverified
      // classification is a lead, not a verdict — the public badge is owned by
      // scripts/maintenance/reconcile-first-translation-flag.ts (#3726).
    }

    console.log(`  Saved ${ops.length} results. Running totals: ${JSON.stringify(stats)}`);

    // Rate limiting — 1 second between batches
    if (i + batchSize < books.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('\n=== Final Results ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Never translated: ${stats.never_translated}`);
  console.log(`Previously translated: ${stats.previously_translated}`);
  console.log(`Partially translated: ${stats.partially_translated}`);
  console.log(`Uncertain: ${stats.uncertain}`);
  console.log(`Errors: ${stats.errors}`);

  // Summary query
  const summary = await collection.aggregate([
    { $group: { _id: '$classification', count: { $sum: 1 }, avg_confidence: { $avg: '$confidence' } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log('\n=== DB Summary ===');
  for (const s of summary) {
    console.log(`  ${s._id}: ${s.count} (avg confidence: ${(s.avg_confidence * 100).toFixed(1)}%)`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
