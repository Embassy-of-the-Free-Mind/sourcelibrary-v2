#!/usr/bin/env node
/**
 * Backfill display_title (English title) for non-English books.
 *
 * Lightweight — uses only title + author + language metadata (no OCR needed).
 * Batches titles together in groups of 20 per Gemini call for efficiency.
 *
 * Usage:
 *   node scripts/enrichment/backfill-display-titles.mjs --dry-run
 *   node scripts/enrichment/backfill-display-titles.mjs --apply
 *   node scripts/enrichment/backfill-display-titles.mjs --apply --limit 100
 *   node scripts/enrichment/backfill-display-titles.mjs --apply --language Latin
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';

// ── Config ──────────────────────────────────────────────────────────

const MODEL = 'gemini-3-flash-preview';
const BATCH_SIZE = 20; // Titles per Gemini call
const DELAY_MS = 300;  // Between batches

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── Args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const limitArg = args.find((_, i, a) => a[i - 1] === '--limit');
const limit = limitArg ? parseInt(limitArg) : 0;
const langArg = args.find((_, i, a) => a[i - 1] === '--language');

if (dryRun) {
  console.log('DRY RUN — pass --apply to write changes\n');
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find non-English books missing display_title
  const query = {
    hidden: { $ne: true },
    language: { $nin: ['English', 'Unknown', null, ''] },
    $or: [
      { display_title: { $exists: false } },
      { display_title: null },
      { display_title: '' },
    ],
  };
  if (langArg) {
    query.language = langArg;
  }

  const projection = { id: 1, title: 1, author: 1, language: 1, published: 1 };
  let cursor = db.collection('books').find(query, { projection }).sort({ read_count: -1 });
  if (limit) cursor = cursor.limit(limit);

  const books = await cursor.toArray();
  console.log(`Found ${books.length} books needing display_title\n`);

  if (books.length === 0) {
    await client.close();
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const batches = [];

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    batches.push(books.slice(i, i + BATCH_SIZE));
  }

  console.log(`Processing ${batches.length} batches of up to ${BATCH_SIZE} titles...\n`);

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchNum = batchIdx + 1;

    const titlesForPrompt = batch.map((b, i) => ({
      index: i,
      id: b.id,
      title: b.title,
      author: b.author || 'Unknown',
      language: b.language,
      published: b.published || 'Unknown',
    }));

    const prompt = `You are a rare books librarian. Translate these book titles to English.

For each title, provide a clear, natural English rendering. Use the conventional English name if one is well-established (e.g. "The Chemical Wedding" for "Chymische Hochzeit", "Discourse on the Method" for "Discours de la méthode", "The Art of Memory" for "Ars Memoriae").

Otherwise translate literally but concisely — translate the essential title, not the full baroque subtitle.

If the title already contains an English translation in parentheses, extract that.
If the title is a proper name that doesn't translate (e.g. "Biblia Sacra"), keep it and add a clarifying phrase if helpful (e.g. "Holy Bible (Biblia Sacra)").

Return a JSON array with one object per title:
[
  { "index": 0, "display_title": "English Title Here" },
  ...
]

Titles to translate:
${JSON.stringify(titlesForPrompt, null, 2)}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse JSON array');
        }
      }

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      // Map results back to books
      const resultMap = new Map();
      for (const item of parsed) {
        if (item.index !== undefined && item.display_title) {
          resultMap.set(item.index, item.display_title);
        }
      }

      for (let i = 0; i < batch.length; i++) {
        const book = batch[i];
        const displayTitle = resultMap.get(i);

        if (!displayTitle) {
          totalSkipped++;
          continue;
        }

        // Skip if the AI returned the same text as the original title
        if (displayTitle === book.title) {
          totalSkipped++;
          continue;
        }

        if (dryRun) {
          console.log(`  [${book.language}] ${book.title}`);
          console.log(`    => ${displayTitle}`);
        } else {
          await db.collection('books').updateOne(
            { id: book.id },
            {
              $set: {
                display_title: displayTitle,
                'field_provenance.display_title': {
                  source: 'ai_enrichment',
                  model: MODEL,
                  date: new Date(),
                  note: 'Batch title translation backfill',
                },
                updated_at: new Date(),
              },
            },
          );
          console.log(`  [${book.language}] ${book.title} => ${displayTitle}`);
        }
        totalUpdated++;
      }

      const usage = result.response.usageMetadata;
      console.log(`  Batch ${batchNum}/${batches.length}: ${resultMap.size}/${batch.length} translated (${usage?.promptTokenCount || '?'} in / ${usage?.candidatesTokenCount || '?'} out)\n`);

    } catch (err) {
      console.error(`  Batch ${batchNum} ERROR: ${err.message}`);
      totalErrors += batch.length;
    }

    if (batchIdx < batches.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\nDone. Updated: ${totalUpdated}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`);
  if (dryRun) console.log('(DRY RUN — no changes written. Pass --apply to write.)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
