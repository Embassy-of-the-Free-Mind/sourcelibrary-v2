#!/usr/bin/env node
/**
 * AI-powered book metadata enrichment using Gemini Vision
 *
 * Sends the first N page images of each book to Gemini, which classifies:
 *   - Language of the original text
 *   - Subject categories
 *   - Approximate date (if unknown)
 *   - Brief description
 *
 * Usage:
 *   node scripts/enrich-metadata-vision.mjs --dry-run          # Preview changes
 *   node scripts/enrich-metadata-vision.mjs --apply             # Write to DB
 *   node scripts/enrich-metadata-vision.mjs --apply --limit 50  # First 50 books
 *   node scripts/enrich-metadata-vision.mjs --apply --unknown-only  # Only Unknown language
 *   node scripts/enrich-metadata-vision.mjs --apply --book "Agrippa"  # Specific book
 *   node scripts/enrich-metadata-vision.mjs --apply --pages 5   # Only 5 pages per book
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────

const MODEL = 'gemini-2.5-flash';
const PAGES_PER_BOOK = 25;
const CONCURRENCY = 5; // parallel books
const DELAY_BETWEEN_BATCHES_MS = 1000;

// Categories match LIBRARY_CATEGORIES from src/app/api/categories/route.ts
// plus general-knowledge additions for books outside the esoteric core.
// Use the slug IDs so they map directly to the existing system.
const CATEGORIES = [
  // ── Core esoteric traditions (from LIBRARY_CATEGORIES) ──
  'alchemy',
  'hermeticism',
  'jewish-kabbalah',
  'christian-cabala',
  'neoplatonism',
  'rosicrucianism',
  'freemasonry',
  'natural-philosophy',
  'astrology',
  'natural-magic',
  'ritual-magic',
  'theurgy',
  'mysticism',
  'theology',
  'medicine',
  'gnosticism',
  'theosophy',
  'pythagoreanism',
  'divination',
  'ars-notoria',
  'paracelsian',
  'spiritual-alchemy',
  'christian-mysticism',
  'prisca-theologia',
  'florentine-platonism',
  // ── General knowledge (for non-esoteric books) ──
  'astronomy',
  'mathematics',
  'botany',
  'chemistry',
  'geography',
  'history',
  'law',
  'literature',
  'linguistics',
  'music',
  'architecture',
  'art',
  'military',
  'politics',
  'philosophy',
  // ── Non-Western traditions ──
  'sufism',
  'vedanta',
  'buddhism',
  'daoism',
  'biblical-studies',
];

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
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Collect all Gemini API keys for rotation
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

function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Prompt ───────────────────────────────────────────────────────────

function buildPrompt() {
  return `You are a rare books librarian and translation scholar examining scanned pages of a historical book.

Based on these page images, classify the book AND assess whether an English translation has ever been published. Respond with JSON only — no markdown fences, no explanation.

{
  "language": "<primary language of the text, e.g. Latin, German, French, English, Chinese, Greek, Arabic, Hebrew, Italian, Dutch, Spanish, Sanskrit, Syriac, Armenian, Persian, Turkish, Japanese, Korean, etc.>",
  "secondary_languages": ["<any other languages present, e.g. Greek quotes in a Latin text>"],
  "script": "<writing system: Latin alphabet, Fraktur, Greek, Chinese characters, Hebrew, Arabic, Devanagari, etc.>",
  "categories": ["<1-4 subject tags from EXACTLY this list: ${CATEGORIES.join(', ')}>"],
  "estimated_year": "<best estimate of publication year as a number, e.g. 1617. Look at title pages, colophons, privilege pages, and printing style. null if truly impossible to determine>",
  "estimated_century": "<e.g. '17th century' or '15th-16th century' — fallback if exact year unclear>",
  "description": "<1-2 sentence scholarly description of what this book appears to be about>",
  "confidence": "<high, medium, or low — how confident are you in this classification>",
  "first_translation": {
    "status": "<one of: confirmed_first, likely_first, uncertain, has_partial, has_translation, not_applicable>",
    "reasoning": "<1-2 sentences explaining why you believe this has or hasn't been translated to English before>",
    "known_translations": ["<any known English translations, e.g. 'John Smith, 1923' or 'Penguin Classics edition'>"],
    "confidence": "<high, medium, or low>"
  }
}

Rules:
- For language, identify the LANGUAGE OF THE TEXT, not the language of any modern library stamp or catalog number
- If there are multiple languages (e.g. parallel Latin/Greek), list the primary one and put others in secondary_languages
- For categories, pick 1-4 using ONLY the exact slugs from the list above. Prefer specific esoteric tags (e.g. "alchemy", "hermeticism", "christian-cabala") over generic ones (e.g. "philosophy", "theology"). Use "theology" or "philosophy" only when nothing more specific applies. A book by Jacob Boehme should be "christian-mysticism" not "theology".
- For description, be scholarly and specific: mention the author/subject if you can identify them from the text
- If pages are mostly blank, title pages, or illustrations, do your best from what's visible

First translation assessment rules:
- "confirmed_first": You are confident no English translation of this specific work has ever been published
- "likely_first": Probably never translated, but you cannot be 100% certain (e.g. obscure Latin alchemical text)
- "uncertain": You don't know enough to judge
- "has_partial": Only excerpts, selections, or a very old/archaic partial translation exists
- "has_translation": A full English translation is known to exist
- "not_applicable": The book is already in English, or is a modern edition/translation
- Most pre-1800 Latin, German, and other non-English texts on alchemy, Hermeticism, Kabbalah, astrology, and natural philosophy were NEVER translated to English. Be aware of this baseline.
- For well-known classical authors (Plato, Aristotle, Virgil, Ovid, Galen, etc.), their major works have translations, but minor/obscure works often do not.
- If the book IS already in English or is a modern translation of another work, set status to "not_applicable"`;
}

// ── Image URL resolution ─────────────────────────────────────────────

function getPageImageUrl(page) {
  // Skip failed URLs (e.g. "failed:HTTP 403")
  const candidates = [page.cropped_photo, page.archived_photo, page.photo, page.photo_original];
  for (const url of candidates) {
    if (url && url.startsWith('http')) return url;
  }
  return null;
}

// ── Core classification ──────────────────────────────────────────────

async function classifyBook(book, pages, pagesPerBook) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,  // gemini-2.5-flash uses thinking tokens that count against this
      responseMimeType: 'application/json',
    },
  });

  // Build image parts
  const imageParts = [];
  const usedPages = pages.slice(0, pagesPerBook);

  for (const page of usedPages) {
    const url = getPageImageUrl(page);
    if (!url) continue;
    imageParts.push({
      fileData: { mimeType: 'image/jpeg', fileUri: url },
    });
  }

  if (imageParts.length === 0) {
    return { error: 'no_images', pages_checked: 0 };
  }

  // Gemini wants inline_data for URLs — use fileData only for Cloud Storage
  // For HTTP URLs, we need to pass them as image URLs via the parts API
  const parts = [];
  for (const page of usedPages) {
    const url = getPageImageUrl(page);
    if (!url) continue;
    // Use URL-based image reference
    parts.push({ text: '' }); // Gemini needs at least one text part
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: '', // placeholder
      }
    });
  }

  // Actually, for URL-based images with the @google/generative-ai SDK,
  // we need to fetch them. But that's expensive for 10 images.
  // Instead, use the URL directly in a text prompt and let Gemini fetch.
  // The newer SDK supports image URLs directly.

  // Build content with image URLs as text references
  const prompt = buildPrompt();
  const content = [
    { text: `${prompt}\n\nHere are the first ${usedPages.length} pages of the book "${book.title}" by ${book.author || 'Unknown'}:\n` },
  ];

  // Add each image URL as a part
  for (const page of usedPages) {
    const url = getPageImageUrl(page);
    if (!url) continue;
    content.push({ text: `[Page ${page.page_number || '?'}]` });
    content.push({ image: url }); // Will be converted below
  }

  // The @google/generative-ai SDK doesn't support image URLs directly.
  // We need to fetch them as base64. Let's do it efficiently.
  const imageContents = [];
  for (const page of usedPages) {
    const url = getPageImageUrl(page);
    if (!url) continue;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      const mimeType = contentType.includes('png') ? 'image/png' :
                       contentType.includes('webp') ? 'image/webp' : 'image/jpeg';
      imageContents.push({
        pageNumber: page.page_number,
        base64: buffer.toString('base64'),
        mimeType,
      });
    } catch (e) {
      // Skip failed images
    }
  }

  if (imageContents.length === 0) {
    return { error: `fetch_failed (tried ${usedPages.length} pages, all failed)`, pages_checked: 0 };
  }

  // Build proper Gemini multimodal request
  const geminiParts = [{ text: prompt + `\n\nBook title: "${book.title}" by ${book.author || 'Unknown'}\nCurrent metadata — language: ${book.language || 'Unknown'}, published: ${book.published || 'Unknown'}\n\nHere are ${imageContents.length} scanned pages:` }];

  for (const img of imageContents) {
    geminiParts.push({ text: `\n[Page ${img.pageNumber || '?'}]` });
    geminiParts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      }
    });
  }

  const startTime = Date.now();
  const result = await model.generateContent({ contents: [{ parts: geminiParts }] });
  const durationMs = Date.now() - startTime;

  const response = result.response;
  const candidates = response.candidates || [];
  const allParts = candidates[0]?.content?.parts || [];
  const fullText = allParts.map(p => p.text || '').join('');
  const text = fullText.trim() || response.text().trim();
  const usage = response.usageMetadata || {};

  // Parse JSON response
  let parsed;
  try {
    // Try direct parse first
    parsed = JSON.parse(text);
  } catch (e1) {
    // Extract JSON from potential markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.log(`    [DEBUG] Parse error: ${e2.message}`);
        console.log(`    [DEBUG] Extracted: ${jsonMatch[0].substring(0, 500)}`);
        return {
          error: 'parse_failed',
          raw_response: text.substring(0, 500),
          pages_checked: imageContents.length,
          usage,
          duration_ms: durationMs,
        };
      }
    } else {
      console.log(`    [DEBUG] No JSON found. Parse error: ${e1.message}`);
      console.log(`    [DEBUG] Full response (${text.length} chars): ${text.substring(0, 500)}`);
      return {
        error: 'parse_failed',
        raw_response: text.substring(0, 500),
        pages_checked: imageContents.length,
        usage,
        duration_ms: durationMs,
      };
    }
  }

  return {
    ...parsed,
    pages_checked: imageContents.length,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
    duration_ms: durationMs,
  };
}

// ── Token cost calculation ───────────────────────────────────────────

function calculateCost(usage) {
  // gemini-2.5-flash pricing
  const inputCostPer1M = 0.15;
  const outputCostPer1M = 0.60;
  return (
    (usage.input_tokens / 1_000_000) * inputCostPer1M +
    (usage.output_tokens / 1_000_000) * outputCostPer1M
  );
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const unknownOnly = args.includes('--unknown-only');
  const datelessOnly = args.includes('--dateless');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;
  const pagesPerBook = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1]) : PAGES_PER_BOOK;
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;

  console.log(`=== Book Metadata Enrichment via Gemini Vision ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to write)' : 'APPLYING CHANGES'}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Pages per book: ${pagesPerBook}`);
  console.log(`API keys: ${apiKeys.length}`);
  console.log(`Limit: ${limit}\n`);

  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Build query
  const filter = {};
  if (unknownOnly) {
    filter.language = 'Unknown';
  }
  if (datelessOnly) {
    // Re-enrich books that were already processed but have no year
    filter.year = { $exists: false };
    filter['ai_metadata.enriched_at'] = { $exists: true };
  } else {
    // Exclude books already enriched by this script
    filter['ai_metadata.enriched_at'] = { $exists: false };
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
    .sort({ pages_count: -1 }) // biggest books first (most likely to have good images)
    .limit(limit)
    .toArray();

  console.log(`Found ${books.length} books to process\n`);

  if (books.length === 0) {
    await mongoClient.close();
    return;
  }

  // Stats
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalCost = 0;
  const languageCounts = {};
  const categoryCounts = {};
  const ftCounts = {};

  // Process in batches for concurrency
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      // Fetch first N pages
      const pages = await db.collection('pages')
        .find({ book_id: book.id })
        .sort({ page_number: 1 })
        .limit(pagesPerBook)
        .project({ page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1 })
        .toArray();

      if (pages.length === 0) {
        return { book, error: 'no_pages' };
      }

      try {
        const result = await classifyBook(book, pages, pagesPerBook);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    // Process results
    for (const r of results) {
      processed++;
      if (r.status === 'rejected') {
        failed++;
        console.log(`  [${processed}/${books.length}] FAIL ${r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 50);

      if (error) {
        failed++;
        console.log(`  [${processed}/${books.length}] SKIP ${shortTitle} — ${error}`);
        continue;
      }

      if (result.error) {
        failed++;
        console.log(`  [${processed}/${books.length}] SKIP ${shortTitle} — ${result.error}`);
        continue;
      }

      succeeded++;

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      // Track stats
      if (result.language) {
        languageCounts[result.language] = (languageCounts[result.language] || 0) + 1;
      }
      if (result.categories) {
        for (const cat of result.categories) {
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      }
      if (result.first_translation?.status) {
        ftCounts[result.first_translation.status] = (ftCounts[result.first_translation.status] || 0) + 1;
      }

      const langChanged = result.language && result.language !== book.language;
      const ft = result.first_translation;
      const ftStatus = ft?.status || '?';
      const marker = langChanged ? '*' : ' ';
      const yearInfo = result.estimated_year ? `Year: ${result.estimated_year}` : (result.estimated_century || '?');
      console.log(`${marker} [${processed}/${books.length}] ${shortTitle}`);
      console.log(`    Language: ${book.language || 'Unknown'} -> ${result.language || '?'} | ${yearInfo} | Categories: ${(result.categories || []).join(', ')} | ${result.confidence} | $${cost.toFixed(4)}`);
      console.log(`    First translation: ${ftStatus} | ${ft?.reasoning?.substring(0, 100) || ''}`);
      if (result.description) {
        console.log(`    ${result.description.substring(0, 120)}`);
      }

      // Apply changes — with full provenance tracking
      if (!dryRun) {
        const enrichment = {
          language: result.language,
          secondary_languages: result.secondary_languages || [],
          script: result.script,
          categories: result.categories || [],
          estimated_century: result.estimated_century,
          description: result.description,
          confidence: result.confidence,
          first_translation: result.first_translation || null,
          model: MODEL,
          pages_checked: result.pages_checked,
          enriched_at: new Date(),
          // Provenance: track what fields were changed and from what
          changes: [],
        };

        const updates = {
          updated_at: new Date(),
        };

        // Update language if currently Unknown and we have a classification
        if (book.language === 'Unknown' && result.language && result.confidence !== 'low') {
          updates.language = result.language;
          enrichment.changes.push({
            field: 'language',
            previous: book.language,
            new_value: result.language,
          });
        }

        // Update year if missing and we have an AI estimate
        if (!book.year && result.estimated_year) {
          const year = parseInt(result.estimated_year);
          if (!isNaN(year) && year > 0 && year < 2100) {
            updates.year = year;
            enrichment.changes.push({
              field: 'year',
              previous: book.year || null,
              new_value: year,
            });
            // Also set published if missing
            if (!book.published || book.published === 'Unknown') {
              updates.published = String(year);
              enrichment.changes.push({
                field: 'published',
                previous: book.published || null,
                new_value: String(year),
              });
            }
          }
        }

        // Set categories — merge AI categories with existing ones, don't overwrite
        if (result.categories?.length > 0) {
          const existing = book.categories || [];
          // Deduplicate: keep existing + add new AI ones
          const merged = [...new Set([...existing, ...result.categories])];
          if (merged.length !== existing.length) {
            updates.categories = merged;
            enrichment.changes.push({
              field: 'categories',
              previous: existing,
              new_value: merged,
              ai_suggested: result.categories,
            });
          }
        }

        updates.ai_metadata = enrichment;

        // Build field_provenance — merge with any existing provenance
        const now = new Date();
        const aiSource = {
          source: 'ai_enrichment',
          model: MODEL,
          date: now,
          confidence: result.confidence,
          pages_checked: result.pages_checked,
          script: 'enrich-metadata-vision.mjs',
        };
        const provenance = book.field_provenance || {};

        // Always record AI assessment even if we didn't overwrite the field
        if (result.language) {
          if (updates.language) {
            provenance.language = { ...aiSource, previous_value: book.language };
          } else if (!provenance.language) {
            // Field already had a value — record that AI confirmed it
            provenance.language = provenance.language || {
              source: 'import',
              note: `AI confirmed as "${result.language}" (${result.confidence})`,
              ai_confirmed_at: now,
            };
          }
        }
        if (updates.year) {
          provenance.year = { ...aiSource, previous_value: book.year || null };
        }
        if (updates.published) {
          provenance.published = { ...aiSource, previous_value: book.published || null };
        }
        if (updates.categories) {
          provenance.categories = {
            ...aiSource,
            previous_value: book.categories || [],
            ai_suggested: result.categories,
            note: book.categories?.length ? 'merged with existing' : 'ai_enrichment',
          };
        }
        if (result.description) {
          provenance.description = aiSource;
        }
        if (result.first_translation) {
          provenance.first_translation = {
            ...aiSource,
            status: result.first_translation.status,
          };
        }

        updates.field_provenance = provenance;

        try {
          await db.collection('books').updateOne({ id: book.id }, { $set: updates });

          // Log to gemini_usage
          await db.collection('gemini_usage').insertOne({
            timestamp: new Date(),
            type: 'other',
            mode: 'realtime',
            model: MODEL,
            book_id: book.id,
            book_title: book.display_title || book.title,
            page_count: result.pages_checked,
            input_tokens: result.usage?.input_tokens || 0,
            output_tokens: result.usage?.output_tokens || 0,
            cost_usd: cost,
            status: 'success',
            duration_ms: result.duration_ms,
            endpoint: 'script/enrich-metadata-vision',
          });
        } catch (dbErr) {
          console.log(`    [DB ERROR] ${dbErr.message}`);
          failed++;
          succeeded--;
        }
      }
    }

    // Delay between batches
    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed/Skipped: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost/book: $${succeeded > 0 ? (totalCost / succeeded).toFixed(4) : '0'}`);

  if (Object.keys(languageCounts).length > 0) {
    console.log('\n--- Languages Detected ---');
    const sorted = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);
    for (const [lang, count] of sorted) {
      console.log(`  ${lang}: ${count}`);
    }
  }

  if (Object.keys(categoryCounts).length > 0) {
    console.log('\n--- Categories Detected ---');
    const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      console.log(`  ${cat}: ${count}`);
    }
  }

  if (Object.keys(ftCounts).length > 0) {
    console.log('\n--- First Translation Status ---');
    const sorted = Object.entries(ftCounts).sort((a, b) => b[1] - a[1]);
    for (const [status, count] of sorted) {
      console.log(`  ${status}: ${count}`);
    }
  }

  if (dryRun) {
    console.log('\n(Dry run — no changes written. Use --apply to write to DB.)');
  }

  await mongoClient.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
