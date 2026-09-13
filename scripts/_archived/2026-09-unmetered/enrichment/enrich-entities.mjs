#!/usr/bin/env node

/**
 * Entity Enrichment Script
 *
 * Enriches entities in the `entities` collection with:
 * - description: 1-2 sentence description
 * - aliases: alternative names/spellings
 * - wikipedia_url: Wikipedia article URL
 *
 * Uses Gemini to generate enrichment from entity names + book context.
 * Batches ~25 entities per API call for efficiency.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/enrich-entities.mjs
 *
 * Options:
 *   --min-books=N    Minimum book count (default: 5)
 *   --type=TYPE      Filter by type: person, place, concept (default: all)
 *   --limit=N        Max entities to process (default: unlimited)
 *   --dry-run        Show what would be done without writing
 *   --offset=N       Skip first N entities
 *   --batch-size=N   Entities per Gemini call (default: 25)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// --- Config ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const MIN_BOOKS = parseInt(args['min-books'] || '5');
const TYPE_FILTER = args.type || null;
const LIMIT = args.limit ? parseInt(args.limit) : Infinity;
const DRY_RUN = args['dry-run'] === 'true';
const OFFSET = parseInt(args.offset || '0');
const BATCH_SIZE = parseInt(args['batch-size'] || '25');
const MODEL = 'gemini-3-flash-preview';

// Use TIER3 key for heavy work, fall back to primary
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY or GEMINI_API_KEY_TIER3');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Prompt ---
function buildPrompt(entities) {
  const entityList = entities.map((e, i) => {
    const bookTitles = e.books.slice(0, 5).map(b => b.book_title).join('; ');
    const moreBooks = e.books.length > 5 ? ` (+${e.books.length - 5} more)` : '';
    return `${i + 1}. "${e.name}" [${e.type}] — appears in: ${bookTitles}${moreBooks}`;
  }).join('\n');

  return `You are enriching an encyclopedia of historical figures, places, and concepts from a digital library of rare texts (15th-18th century Western esotericism, alchemy, Hermetica, Kabbalah, natural philosophy, theology).

For each entity below, provide:
1. **description**: A concise 1-2 sentence description suitable for an encyclopedia entry. Focus on why this entity matters in the context of Western intellectual history, esotericism, or the history of ideas. Be factual and scholarly.
2. **aliases**: Alternative names, spellings, or forms this entity is known by. Include Latin/Greek forms, common misspellings in early modern texts, and abbreviated forms. Return empty array if no meaningful aliases exist.
3. **wikipedia_article**: The exact Wikipedia article title (not URL) if one exists. Use the most specific article. Return null if no Wikipedia article exists or you're unsure.

Entities to enrich:
${entityList}

Respond with a JSON array. Each element must have:
- "index": the entity number (1-based)
- "description": string
- "aliases": string[]
- "wikipedia_article": string | null

Example response:
[
  {"index": 1, "description": "Greek philosopher who founded the Lyceum...", "aliases": ["Aristoteles", "The Stagirite", "The Philosopher"], "wikipedia_article": "Aristotle"},
  {"index": 2, "description": "Ancient Egyptian city...", "aliases": ["Heliopolis"], "wikipedia_article": "Heliopolis (ancient Egypt)"}
]

Return ONLY the JSON array, no markdown formatting or code blocks.`;
}

// --- Gemini Call ---
async function callGemini(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error('Empty response');

      // Parse JSON (strip markdown code blocks if present)
      const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      // Extract token usage
      const usage = response.usageMetadata || {};

      return { results: parsed, usage };
    } catch (err) {
      if (attempt < retries) {
        const delay = attempt * 2000;
        console.warn(`  Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// --- Main ---
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const entitiesCol = db.collection('entities');
  const usageCol = db.collection('gemini_usage');

  // Build query
  const query = {
    book_count: { $gte: MIN_BOOKS },
    // Only enrich entities that don't have a description yet
    $or: [
      { description: { $exists: false } },
      { description: null },
      { description: '' },
    ],
  };
  if (TYPE_FILTER) query.type = TYPE_FILTER;

  const totalToProcess = await entitiesCol.countDocuments(query);
  console.log(`\n=== Entity Enrichment ===`);
  console.log(`Filter: ${MIN_BOOKS}+ books, type=${TYPE_FILTER || 'all'}`);
  console.log(`Entities to enrich: ${totalToProcess}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Estimated batches: ${Math.ceil(Math.min(totalToProcess - OFFSET, LIMIT) / BATCH_SIZE)}`);
  console.log('');

  // Load all entity IDs upfront to avoid cursor timeout during slow Gemini calls
  const allEntities = await entitiesCol.find(query)
    .sort({ book_count: -1 })
    .skip(OFFSET)
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .project({ name: 1, type: 1, book_count: 1, books: { $slice: 6 } })
    .toArray();

  console.log(`Loaded ${allEntities.length} entities into memory\n`);

  let processed = 0;
  let enriched = 0;
  let errors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < allEntities.length; i += BATCH_SIZE) {
    const batch = allEntities.slice(i, i + BATCH_SIZE);
    const result = await processBatch(batch, entitiesCol, usageCol, DRY_RUN);
    enriched += result.enriched;
    errors += result.errors;
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    processed += batch.length;

    console.log(`  Progress: ${processed}/${allEntities.length} | Enriched: ${enriched} | Errors: ${errors} | Tokens: ${totalInputTokens}in/${totalOutputTokens}out`);

    // Rate limit: 100ms between calls
    await new Promise(r => setTimeout(r, 100));
  }

  // Estimate cost
  const inputCost = (totalInputTokens / 1_000_000) * 0.15; // flash preview input
  const outputCost = (totalOutputTokens / 1_000_000) * 0.60; // flash preview output
  const totalCost = inputCost + outputCost;

  console.log(`\n=== Done ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Errors: ${errors}`);
  console.log(`Tokens: ${totalInputTokens} input, ${totalOutputTokens} output`);
  console.log(`Estimated cost: $${totalCost.toFixed(4)}`);

  await client.close();
}

async function processBatch(entities, entitiesCol, usageCol, dryRun) {
  const names = entities.map(e => e.name).join(', ');
  console.log(`\nBatch (${entities.length}): ${names.slice(0, 100)}...`);

  let enrichedCount = 0;
  let errorCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const prompt = buildPrompt(entities);

    if (dryRun) {
      console.log('  [DRY RUN] Would call Gemini with prompt length:', prompt.length);
      return { enriched: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
    }

    const { results, usage } = await callGemini(prompt);
    inputTokens = usage.promptTokenCount || 0;
    outputTokens = usage.candidatesTokenCount || 0;

    if (!Array.isArray(results)) {
      console.error('  Invalid response format (not array)');
      return { enriched: 0, errors: entities.length, inputTokens, outputTokens };
    }

    // Process each result
    for (const result of results) {
      const idx = result.index - 1;
      if (idx < 0 || idx >= entities.length) {
        console.warn(`  Skipping invalid index ${result.index}`);
        errorCount++;
        continue;
      }

      const entity = entities[idx];
      const update = { updated_at: new Date() };

      // Description
      if (result.description && typeof result.description === 'string' && result.description.length > 10) {
        update.description = result.description;
      }

      // Aliases
      if (Array.isArray(result.aliases) && result.aliases.length > 0) {
        // Filter out aliases that are just the entity name
        const validAliases = result.aliases.filter(a =>
          typeof a === 'string' &&
          a.length > 0 &&
          a.toLowerCase() !== entity.name.toLowerCase()
        );
        if (validAliases.length > 0) {
          update.aliases = validAliases;
        }
      }

      // Wikipedia URL
      if (result.wikipedia_article && typeof result.wikipedia_article === 'string') {
        update.wikipedia_url = `https://en.wikipedia.org/wiki/${encodeURIComponent(result.wikipedia_article.replace(/ /g, '_'))}`;
      }

      // Only update if we have something meaningful
      if (update.description || update.aliases || update.wikipedia_url) {
        await entitiesCol.updateOne(
          { _id: entity._id },
          { $set: update }
        );
        enrichedCount++;

        const parts = [];
        if (update.description) parts.push('desc');
        if (update.aliases) parts.push(`${update.aliases.length} aliases`);
        if (update.wikipedia_url) parts.push('wiki');
        // Only log first few per batch
        if (enrichedCount <= 3) {
          console.log(`  + ${entity.name}: ${parts.join(', ')}`);
        }
      } else {
        console.log(`  - ${entity.name}: no enrichment data`);
        errorCount++;
      }
    }

    // Log to gemini_usage
    await usageCol.insertOne({
      type: 'entity_enrichment',
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      entities_processed: entities.length,
      entities_enriched: enrichedCount,
      timestamp: new Date(),
    }).catch(() => {}); // non-blocking

  } catch (err) {
    console.error(`  Batch error: ${err.message}`);
    errorCount = entities.length;

    // Log error
    await usageCol.insertOne({
      type: 'entity_enrichment',
      model: MODEL,
      status: 'error',
      error: err.message,
      entities_processed: entities.length,
      timestamp: new Date(),
    }).catch(() => {});
  }

  return { enriched: enrichedCount, errors: errorCount, inputTokens, outputTokens };
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
