#!/usr/bin/env node
/**
 * Stage 2: LLM deep knowledge check for first-translation claims.
 *
 * For ALL non-English translated books that have ai_metadata.first_translation
 * but no translation_verification. Uses Gemini text-only (no images) to ask
 * "has this work EVER been translated into English?"
 *
 * Based on scripts/enrichment/verify-first-translations.mjs but extended
 * to all languages (not just Latin).
 *
 * Usage:
 *   node _tmp-verify-ft-stage2.mjs --dry-run          # Preview
 *   node _tmp-verify-ft-stage2.mjs --apply             # Write to DB
 *   node _tmp-verify-ft-stage2.mjs --apply --limit 50  # First 50
 *   node _tmp-verify-ft-stage2.mjs --apply --skip-has   # Skip books already marked has_translation
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';

const MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 5;
const DELAY_MS = 500;

// ── Env ─────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function getApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) {
    if (process.env[`GEMINI_API_KEY_${i}`]) keys.push(process.env[`GEMINI_API_KEY_${i}`]);
  }
  if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
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
  const language = book.language || book.ai_metadata?.language || 'Unknown';

  // Include Stage 1 assessment as hint
  const stage1 = book.ai_metadata?.first_translation;
  const stage1Hint = stage1
    ? `\n\nPRELIMINARY AI ASSESSMENT: ${stage1.status} (${stage1.confidence} confidence)\nReasoning: ${stage1.reasoning || 'N/A'}\nKnown translations: ${(stage1.known_translations || []).join(', ') || 'None listed'}`
    : '';

  return `You are a bibliographic research assistant specializing in the history of translation.

I need you to determine whether the following work has EVER been translated into English:

WORK: "${title}"
AUTHOR: ${author}
ORIGINAL LANGUAGE: ${language}
DATE: ${published}
${stage1Hint}

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

async function verifyBook(book, retries = 2) {
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

  let result;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err) {
      if (attempt < retries && (err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET'))) {
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
    ...parsed,
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
  const skipHas = args.includes('--skip-has');

  console.log('=== Stage 2: LLM Verification (all languages) ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL} (text only)`);
  console.log(`API keys: ${apiKeys.length}`);
  if (limit) console.log(`Limit: ${limit}`);
  if (skipHas) console.log('Skipping books where Stage 1 said has_translation');

  const mongo = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000 });
  await mongo.connect();
  const db = mongo.db(MONGODB_DB);

  // Find non-English books with first_translation assessment but no verification
  const query = {
    language: { $nin: ['English', 'english', null, ''] },
    'ai_metadata.first_translation': { $exists: true },
    'translation_verification': { $exists: false },
    pages_translated: { $gt: 0 },
  };

  // Optionally skip books already marked as having translations
  if (skipHas) {
    query['ai_metadata.first_translation.status'] = {
      $nin: ['has_translation', 'not_applicable'],
    };
  }

  const totalCount = await db.collection('books').countDocuments(query);
  console.log(`\nFound ${totalCount} books needing verification`);

  // Status breakdown
  const statusBreakdown = await db.collection('books').aggregate([
    { $match: query },
    { $group: { _id: '$ai_metadata.first_translation.status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('Status breakdown:');
  for (const s of statusBreakdown) console.log(`  ${s._id}: ${s.count}`);

  const cursor = db.collection('books')
    .find(query, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, ai_metadata: 1,
      },
    })
    .sort({ pages_translated: -1 });

  if (limit) cursor.limit(limit);
  const books = await cursor.toArray();
  console.log(`\nProcessing ${books.length} books\n`);

  let processed = 0;
  let hasTranslation = 0;
  let noTranslation = 0;
  let uncertain = 0;
  let errors = 0;
  let totalCost = 0;

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
      processed++;
      if (r.status === 'rejected') {
        errors++;
        console.log(`  [${processed}/${books.length}] FAIL: ${r.reason?.message || r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);
      const lang = book.language?.substring(0, 8) || '?';
      const stage1Status = book.ai_metadata?.first_translation?.status || '?';

      if (error || result?.error) {
        errors++;
        console.log(`  [${processed}/${books.length}] ERROR ${shortTitle} — ${error || result.error}`);
        continue;
      }

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      const found = result.has_english_translation;
      const translationCount = result.translations?.length || 0;
      const conf = result.confidence || '?';

      // Determine disposition
      let disposition;
      if (found && conf !== 'low') {
        disposition = 'translation_found';
        hasTranslation++;
      } else if (!found && (conf === 'high' || conf === 'medium')) {
        disposition = 'confirmed_first';
        noTranslation++;
      } else {
        disposition = 'needs_review';
        uncertain++;
      }

      const icon = disposition === 'confirmed_first' ? 'FIRST'
        : disposition === 'translation_found' ? 'FOUND'
        : 'REVEW';

      console.log(`  [${processed}/${books.length}] ${icon} [${lang}] ${shortTitle}`);
      console.log(`         stage1=${stage1Status} → stage2=${disposition} (${conf}) | ${translationCount} trans | $${cost.toFixed(4)}`);
      if (found && result.translations?.[0]) {
        const t = result.translations[0];
        console.log(`         -> ${t.pub_year || '?'} "${(t.english_title || '').substring(0, 60)}" (${t.completeness || '?'})`);
      }
      if (result.reasoning) console.log(`         ${result.reasoning.substring(0, 120)}`);

      // Write to DB
      if (!dryRun) {
        const verification = {
          has_english_translation: result.has_english_translation,
          translations: result.translations || [],
          confidence: result.confidence,
          reasoning: result.reasoning,
          search_notes: result.search_notes,
          disposition,
          model: MODEL,
          verified_at: new Date(),
          source: 'gemini_knowledge_lookup',
          stage: 2,
        };

        // If Stage 2 says translation exists but Stage 1 said likely_first/confirmed_first,
        // update is_first_translation to false
        const updates = {
          translation_verification: verification,
          updated_at: new Date(),
        };

        if (disposition === 'translation_found') {
          updates.is_first_translation = false;
        } else if (disposition === 'confirmed_first') {
          updates.is_first_translation = true;
        }

        await db.collection('books').updateOne(
          { id: book.id },
          { $set: updates },
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
          endpoint: 'script/verify-first-translation-stage2',
        });
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Confirmed first (no translation found): ${noTranslation}`);
  console.log(`Translation found: ${hasTranslation}`);
  console.log(`Needs review: ${uncertain}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB)');

  await mongo.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
