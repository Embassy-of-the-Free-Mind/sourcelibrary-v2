#!/usr/bin/env node
/**
 * Deep first-translation classification for astrology books.
 *
 * Combines:
 * 1. Gemini batch classification (like classify-first-translations.mjs)
 * 2. Gemini individual verification (like verify-first-translations.mjs)
 *
 * Results saved to `translation_classification` collection
 * and `book.first_translation_assessment` field.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/analysis/classify-astrology-translations.mjs
 *   Add --dry-run for preview
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const BATCH_SIZE = args.includes('--batch-size') ? parseInt(args[args.indexOf('--batch-size') + 1]) : 20;
const MODEL = 'gemini-3.1-flash-lite-preview';
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!API_KEY) { console.error('No Gemini API key'); process.exit(1); }

const CLASSIFICATION_PROMPT = `You are a scholarly bibliographer specializing in the history of English translations.

For each book listed below, assess whether a PUBLISHED English translation of this specific work exists. Consider:

1. **The specific work** — not just any work by the same author, but THIS specific text/treatise/edition
2. **Published translations** — academic, commercial, or scholarly. Self-published modern translations count. Blog/website translations do NOT count unless they're well-known scholarly resources.
3. **Partial translations count** — if major portions have been translated in anthologies or collected works, note that.
4. **The distinction between famous and obscure** — e.g., Ptolemy's Tetrabiblos has well-known English translations, but many medieval astrological commentaries do not.
5. **Sanskrit/Arabic/Chinese texts** — many classical astrology texts in these languages have NEVER been translated to English even when famous in their original tradition.
6. **Modern Indian astrology publishers** — Some Sanskrit jyotish texts have been published in English by Indian publishers (Motilal Banarsidass, Ranjan Publications, etc.). These count as translations.

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
- Be CONSERVATIVE with "never_translated" — if unsure, prefer "uncertain"
- For multi-volume works, assess THAT specific volume

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
      model: MODEL,
      contents: prompt,
      config: { temperature: 0.1, maxOutputTokens: 8192 }
    });

    let text = response.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const results = JSON.parse(text);
    if (!Array.isArray(results)) throw new Error('Response is not an array');
    return results;
  } catch (err) {
    console.error(`  Batch ${batchNum} error:`, err.message);
    return null;
  }
}

async function main() {
  console.log('=== Astrology First-Translation Deep Classification ===');
  console.log(`Model: ${MODEL}, Dry run: ${dryRun}\n`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find astrology books (non-English, with some translation)
  const allAstrology = await db.collection('books').find({
    $or: [
      { categories: { $regex: /astrolog/i } },
      { title: { $regex: /astrolog/i } },
      { display_title: { $regex: /astrolog/i } }
    ],
    language: { $nin: ['English', 'english', null] },
    pages_translated: { $gt: 0 }
  }, {
    projection: {
      _id: 1, id: 1, title: 1, display_title: 1, author: 1,
      year: 1, language: 1, published: 1, categories: 1,
      pages_count: 1, pages_translated: 1
    }
  }).sort({ title: 1 }).toArray();

  console.log(`Total non-English astrology books with translations: ${allAstrology.length}`);

  // Check which already have classification
  const existingClassifications = await db.collection('translation_classification')
    .find({ book_id: { $in: allAstrology.map(b => b.id) } }, { projection: { book_id: 1 } })
    .toArray();
  const classifiedIds = new Set(existingClassifications.map(e => e.book_id));

  const needsClassification = allAstrology.filter(b => !classifiedIds.has(b.id));
  console.log(`Already classified: ${classifiedIds.size}`);
  console.log(`Needs classification: ${needsClassification.length}`);

  // Language breakdown
  const byLang = {};
  needsClassification.forEach(b => {
    const lang = b.language || 'Unknown';
    byLang[lang] = (byLang[lang] || 0) + 1;
  });
  console.log(`Languages: ${JSON.stringify(byLang)}\n`);

  if (needsClassification.length === 0) {
    console.log('All astrology books already classified!');
    await printSummary(db, allAstrology);
    await client.close();
    return;
  }

  if (dryRun) {
    console.log('DRY RUN — first batch:');
    needsClassification.slice(0, BATCH_SIZE).forEach((b, i) => {
      console.log(`  ${i + 1}. [${b.language}] ${(b.display_title || b.title || '').substring(0, 70)} — ${(b.author || 'Unknown').substring(0, 30)}`);
    });
    console.log(`\n...and ${needsClassification.length - BATCH_SIZE} more`);
    await client.close();
    return;
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const collection = db.collection('translation_classification');
  await collection.createIndex({ book_id: 1 }, { unique: true });
  await collection.createIndex({ classification: 1 });

  let totalProcessed = 0;
  let stats = { never_translated: 0, previously_translated: 0, partially_translated: 0, uncertain: 0, errors: 0 };

  for (let i = 0; i < needsClassification.length; i += BATCH_SIZE) {
    const batch = needsClassification.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(needsClassification.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} books)...`);

    const results = await classifyBatch(ai, batch, batchNum);

    if (!results) {
      stats.errors += batch.length;
      console.log(`  FAILED — skipping batch`);
      continue;
    }

    const ops = [];
    const bookUpdates = [];
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
        model: MODEL,
        classified_at: new Date(),
        source: 'astrology_deep_classification'
      };

      ops.push({
        updateOne: {
          filter: { book_id: book.id },
          update: { $set: doc },
          upsert: true
        }
      });

      // Map classification to first_translation_assessment status
      const statusMap = {
        'never_translated': 'confirmed_first',
        'previously_translated': 'has_translation',
        'partially_translated': 'has_partial',
        'uncertain': 'uncertain'
      };

      bookUpdates.push({
        updateOne: {
          filter: { id: book.id },
          update: {
            $set: {
              'first_translation_assessment': {
                status: statusMap[result.classification] || 'uncertain',
                reason: result.reasoning,
                known_translation: result.known_translation || null,
                confidence: result.confidence >= 0.8 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
                assessed_at: new Date(),
                assessed_by: `gemini/${MODEL}/astrology_deep_classification`
              },
              updated_at: new Date()
            }
          }
        }
      });

      const icon = result.classification === 'never_translated' ? '  NEW' :
                   result.classification === 'previously_translated' ? '  HAS' :
                   result.classification === 'partially_translated' ? '  PAR' : '  UNK';
      const conf = Math.round(result.confidence * 100);
      console.log(`${icon} [${conf}%] ${(book.display_title || book.title || '').substring(0, 60)} — ${(book.author || '?').substring(0, 25)}`);
      if (result.known_translation) {
        console.log(`       -> ${result.known_translation.substring(0, 100)}`);
      }

      stats[result.classification] = (stats[result.classification] || 0) + 1;
      totalProcessed++;
    }

    if (ops.length > 0) {
      await collection.bulkWrite(ops);
      await db.collection('books').bulkWrite(bookUpdates);
    }

    console.log(`  Saved ${ops.length} results. Running: ${JSON.stringify(stats)}`);

    // Rate limiting
    if (i + BATCH_SIZE < needsClassification.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\n=== Classification Complete ===`);
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Never translated (first!): ${stats.never_translated}`);
  console.log(`Previously translated: ${stats.previously_translated}`);
  console.log(`Partially translated: ${stats.partially_translated}`);
  console.log(`Uncertain: ${stats.uncertain}`);
  console.log(`Errors: ${stats.errors}`);

  await printSummary(db, allAstrology);
  await client.close();
}

async function printSummary(db, allAstrology) {
  const bookIds = allAstrology.map(b => b.id);

  // Get all classifications
  const classifications = await db.collection('translation_classification')
    .find({ book_id: { $in: bookIds } })
    .toArray();

  const classMap = {};
  classifications.forEach(c => classMap[c.book_id] = c);

  // Also check ai_metadata for books not in classification collection
  const books = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { id: 1, display_title: 1, title: 1, author: 1, year: 1, language: 1,
                    pages_count: 1, pages_translated: 1,
                    'ai_metadata.first_translation': 1, 'first_translation_assessment': 1 } }
  ).toArray();

  const bookMap = {};
  books.forEach(b => bookMap[b.id] = b);

  // Final counts using best available data
  let confirmed = 0, likely = 0, uncertain = 0, hasTranslation = 0, partial = 0, noData = 0;
  const firstTranslations = [];

  for (const b of allAstrology) {
    const cls = classMap[b.id];
    const book = bookMap[b.id];
    let status = null;

    if (cls) {
      status = cls.classification;
    } else if (book?.first_translation_assessment?.status) {
      const s = book.first_translation_assessment.status;
      if (s === 'confirmed_first') status = 'never_translated';
      else if (s === 'likely_first') status = 'never_translated';
      else if (s === 'has_translation') status = 'previously_translated';
      else if (s === 'has_partial') status = 'partially_translated';
      else status = 'uncertain';
    } else if (book?.ai_metadata?.first_translation?.status) {
      const s = book.ai_metadata.first_translation.status;
      if (s === 'confirmed_first' || s === 'likely_first') status = 'never_translated';
      else if (s === 'has_translation') status = 'previously_translated';
      else if (s === 'has_partial') status = 'partially_translated';
      else status = 'uncertain';
    }

    if (!status) { noData++; continue; }
    if (status === 'never_translated') {
      confirmed++;
      firstTranslations.push({
        title: (b.display_title || b.title || '').substring(0, 70),
        author: (b.author || '').substring(0, 35),
        year: b.year,
        lang: b.language,
        pages: b.pages_count,
        translated: b.pages_translated,
        pct: b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0,
        reasoning: cls?.reasoning || book?.first_translation_assessment?.reason || ''
      });
    }
    else if (status === 'previously_translated') hasTranslation++;
    else if (status === 'partially_translated') partial++;
    else if (status === 'uncertain') uncertain++;
    else noData++;
  }

  console.log(`\n=== FINAL ASTROLOGY FIRST-TRANSLATION SUMMARY ===`);
  console.log(`Total non-English astrology books with translations: ${allAstrology.length}`);
  console.log(`First English translations (never before translated): ${confirmed}`);
  console.log(`Previously translated: ${hasTranslation}`);
  console.log(`Partially translated: ${partial}`);
  console.log(`Uncertain: ${uncertain}`);
  console.log(`No data: ${noData}`);

  // Show first translations by language
  const firstByLang = {};
  firstTranslations.forEach(b => {
    firstByLang[b.lang] = (firstByLang[b.lang] || 0) + 1;
  });
  console.log(`\nFirst translations by language: ${JSON.stringify(firstByLang)}`);

  // Show completed first translations (80%+)
  const completed = firstTranslations.filter(b => b.pct >= 80).sort((a, b) => b.pct - a.pct);
  console.log(`\nCompleted first translations (80%+): ${completed.length}`);
  for (const b of completed) {
    console.log(`  [${b.pct}%] ${b.title} — ${b.author} (${b.year}, ${b.lang})`);
  }

  // Show in-progress first translations
  const inProgress = firstTranslations.filter(b => b.pct > 0 && b.pct < 80).sort((a, b) => b.pct - a.pct);
  console.log(`\nIn-progress first translations (<80%): ${inProgress.length}`);
  for (const b of inProgress.slice(0, 15)) {
    console.log(`  [${b.pct}%] ${b.title} — ${b.author} (${b.year}, ${b.lang})`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
