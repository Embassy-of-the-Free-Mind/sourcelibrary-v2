#!/usr/bin/env node
/**
 * Verify "first translation" claims by searching for English translations.
 *
 * For Latin books where the census says "no translation found" or where
 * AI assessment disagrees with the census, uses Gemini to do a deep
 * knowledge lookup (no images, just text — cheap and fast).
 *
 * When translations ARE found that the census missed, outputs them as
 * new CSV rows that can be appended to latin_translations_master.csv.
 *
 * Usage:
 *   node scripts/verify-first-translations.mjs --dry-run          # Preview
 *   node scripts/verify-first-translations.mjs --apply            # Write to DB + CSV
 *   node scripts/verify-first-translations.mjs --apply --limit 50 # First 50
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 5;
const DELAY_MS = 500;
const NEW_DISCOVERIES_CSV = '/Users/dereklomas/secondrenaissance/scripts/latin_translations_new_discoveries.csv';

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  }
  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY'); process.exit(1); }
let keyIndex = 0;

function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Prompt ──────────────────────────────────────────────────────────

function buildVerificationPrompt(book) {
  const author = book.author || 'Unknown';
  const title = book.display_title || book.title || 'Unknown';
  const published = book.published || 'Unknown date';
  const language = book.language || book.ai_metadata?.language || 'Latin';

  return `You are a bibliographic research assistant specializing in the history of translation.

I need you to determine whether the following work has EVER been translated into English:

WORK: "${title}"
AUTHOR: ${author}
ORIGINAL LANGUAGE: ${language}
DATE: ${published}

Search your knowledge thoroughly. Consider:
1. Major academic publishers (Cambridge UP, Oxford UP, Penguin, Loeb Classical Library, Routledge, Brill, De Gruyter)
2. Specialist publishers (Cazimi Press, Golden Hoard Press, Inner Traditions, ACMRS, Hackett)
3. Older translations (18th-19th century, e.g. Thomas Taylor's Neoplatonist translations)
4. PhD dissertations with translations
5. Journal articles containing translations
6. Recent translations (2010-2025) which are harder to track
7. Partial translations (selections, excerpts, anthologies)

Respond with JSON only:

{
  "has_english_translation": true/false,
  "translations": [
    {
      "english_title": "...",
      "translator": "...",
      "pub_year": "...",
      "publisher": "...",
      "completeness": "complete|partial|excerpts",
      "notes": "any relevant details"
    }
  ],
  "confidence": "high|medium|low",
  "reasoning": "1-2 sentences about your certainty level",
  "search_notes": "what you checked and any ambiguity"
}

If you are not sure, say so. Do NOT hallucinate translations that don't exist.
If this is a well-known work (e.g. Plato's Republic), just confirm with high confidence.
If this is an obscure alchemical text, be honest about uncertainty.`;
}

// ── Core verification ───────────────────────────────────────────────

async function verifyBook(book) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildVerificationPrompt(book);
  const startTime = Date.now();

  const result = await model.generateContent(prompt);
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
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch { return { error: 'parse_failed', raw: text.substring(0, 300) }; }
    } else {
      return { error: 'parse_failed', raw: text.substring(0, 300) };
    }
  }

  return {
    ...parsed,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
    duration_ms: durationMs,
  };
}

// ── CSV output for new discoveries ──────────────────────────────────

function escapeCsv(s) {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function translationToCsvRow(book, translation) {
  const author = book.author || '';
  // Try to extract canonical forms
  const canonical_author = author.split(',')[0].trim() || author;
  return [
    'Source Library verification',  // source
    '',  // series
    escapeCsv(canonical_author),  // author
    escapeCsv(translation.english_title || ''),
    escapeCsv(book.display_title || book.title || ''),  // original_title
    escapeCsv(translation.translator || ''),
    translation.pub_year || '',
    '',  // place
    escapeCsv(translation.publisher || ''),
    '',  // country
    book.published?.match(/\d{4}/)?.[0] || '',  // original_year
    '',  // era
    escapeCsv(canonical_author),  // canonical_author
    escapeCsv(book.display_title || book.title || ''),  // canonical_work
  ].join(',');
}

// ── Cost ────────────────────────────────────────────────────────────

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
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 200;

  console.log(`=== First Translation Verification ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL} (text only, no images)`);
  console.log(`Limit: ${limit}\n`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find Latin books that:
  // 1. Have been cross-referenced against census (translation_census exists)
  // 2. Census says "no_translation_found"
  // 3. Haven't been verified yet
  const books = await db.collection('books')
    .find({
      $or: [
        { 'translation_census.verdict': 'no_translation_found' },
        {
          $and: [
            { $or: [
              { language: { $regex: /latin/i } },
              { 'ai_metadata.language': { $regex: /latin/i } },
            ]},
            { 'translation_verification': { $exists: false } },
          ]
        },
      ],
      'translation_verification': { $exists: false },
    })
    .sort({ pages_count: -1 })
    .limit(limit)
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1,
               ai_metadata: 1, translation_census: 1 })
    .toArray();

  console.log(`Found ${books.length} books to verify\n`);

  let verified = 0;
  let hasTranslation = 0;
  let noTranslation = 0;
  let uncertain = 0;
  let totalCost = 0;
  const newDiscoveries = [];

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      try {
        const result = await verifyBook(book);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    for (const r of results) {
      verified++;
      if (r.status === 'rejected') {
        console.log(`  [${verified}/${books.length}] FAIL: ${r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);
      const shortAuthor = (book.author || 'Unknown').substring(0, 25);

      if (error || result.error) {
        console.log(`  [${verified}/${books.length}] ERROR ${shortTitle} — ${error || result.error}`);
        continue;
      }

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      const found = result.has_english_translation;
      const translationCount = result.translations?.length || 0;
      const conf = result.confidence || '?';

      if (found) {
        hasTranslation++;
        console.log(`  [${verified}/${books.length}] HAS TRANSLATION  ${shortTitle}`);
        console.log(`      Author: ${shortAuthor} | ${translationCount} edition(s) | ${conf} confidence | $${cost.toFixed(4)}`);
        if (result.translations?.[0]) {
          const t = result.translations[0];
          console.log(`      -> ${t.pub_year || '?'} "${(t.english_title || '').substring(0, 60)}" (${t.completeness || '?'})`);
          if (t.translator) console.log(`         trans. ${t.translator}`);
        }

        // Check if this is a new discovery (not in census)
        const censusVerdict = book.translation_census?.verdict;
        if (censusVerdict === 'no_translation_found') {
          for (const t of (result.translations || [])) {
            newDiscoveries.push({ book, translation: t });
          }
        }
      } else if (conf === 'low' || result.confidence === 'low') {
        uncertain++;
        console.log(`  [${verified}/${books.length}] UNCERTAIN       ${shortTitle}`);
        console.log(`      Author: ${shortAuthor} | ${conf} confidence | $${cost.toFixed(4)}`);
      } else {
        noTranslation++;
        console.log(`  [${verified}/${books.length}] NO TRANSLATION  ${shortTitle}`);
        console.log(`      Author: ${shortAuthor} | ${conf} confidence | $${cost.toFixed(4)}`);
      }

      if (result.reasoning) {
        console.log(`      ${result.reasoning.substring(0, 120)}`);
      }

      // Store verification
      if (!dryRun) {
        const verification = {
          has_english_translation: result.has_english_translation,
          translations: result.translations || [],
          confidence: result.confidence,
          reasoning: result.reasoning,
          search_notes: result.search_notes,
          model: MODEL,
          verified_at: new Date(),
          source: 'gemini_knowledge_lookup',
        };

        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { translation_verification: verification, updated_at: new Date() } }
        );

        // Log to gemini_usage
        await db.collection('gemini_usage').insertOne({
          timestamp: new Date(),
          type: 'other',
          mode: 'realtime',
          model: MODEL,
          book_id: book.id,
          book_title: book.display_title || book.title,
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
          cost_usd: cost,
          status: 'success',
          duration_ms: result.duration_ms,
          endpoint: 'script/verify-first-translations',
        });
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Write new discoveries to CSV
  if (newDiscoveries.length > 0) {
    console.log(`\n=== NEW DISCOVERIES (${newDiscoveries.length} translations not in census) ===\n`);
    const csvHeader = 'source,series,author,english_title,original_title,translator,pub_year,place,publisher,country,original_year,era,canonical_author,canonical_work';

    const csvRows = newDiscoveries.map(d => translationToCsvRow(d.book, d.translation));

    for (const d of newDiscoveries) {
      console.log(`  ${d.book.author || '?'} — ${(d.book.title || '').substring(0, 50)}`);
      console.log(`    -> ${d.translation.pub_year || '?'} "${d.translation.english_title || '?'}" (${d.translation.completeness || '?'})`);
    }

    if (!dryRun) {
      // Append to discoveries CSV
      const fileExists = fs.existsSync(NEW_DISCOVERIES_CSV);
      const content = fileExists
        ? '\n' + csvRows.join('\n')
        : csvHeader + '\n' + csvRows.join('\n');
      fs.appendFileSync(NEW_DISCOVERIES_CSV, content + '\n');
      console.log(`\nAppended ${csvRows.length} rows to ${NEW_DISCOVERIES_CSV}`);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Verified: ${verified}`);
  console.log(`Has translation: ${hasTranslation}`);
  console.log(`No translation: ${noTranslation}`);
  console.log(`Uncertain: ${uncertain}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`New discoveries: ${newDiscoveries.length}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB + CSV)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
