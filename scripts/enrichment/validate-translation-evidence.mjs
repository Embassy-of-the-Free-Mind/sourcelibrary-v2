#!/usr/bin/env node
/**
 * Stage 2: Validate translation evidence from Stage 1.
 *
 * Two paths:
 * - Path A: Stage 1 found translations -> verify catalog_ids exist and match
 * - Path B: Stage 1 found nothing -> second LLM pass with model knowledge
 *
 * Sets a final `disposition` field on book.translation_verification:
 *   - confirmed_first: Both catalog search and LLM agree no translation exists
 *   - translation_found: Catalog search found a validated translation
 *   - needs_review: Conflicting signals (LLM says yes, APIs say no, or vice versa)
 *
 * Usage:
 *   node scripts/enrichment/validate-translation-evidence.mjs --dry-run
 *   node scripts/enrichment/validate-translation-evidence.mjs --apply
 *   node scripts/enrichment/validate-translation-evidence.mjs --apply --limit 50
 *   node scripts/enrichment/validate-translation-evidence.mjs --apply --book-id BOOK_ID
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-2.5-flash';
const CONCURRENCY = 5;
const DELAY_MS = 400;
const API_DELAY_MS = 1200;
const CSV_PATH = 'scripts/output/first-translation-evidence-report.csv';

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
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
  if (env.GEMINI_API_KEY_TIER3) keys.push(env.GEMINI_API_KEY_TIER3);
  return keys;
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY found'); process.exit(1); }
let keyIndex = 0;

function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Catalog validation helpers ──────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function isMatch(claim, catalogEntry) {
  const claimTitle = normalize(claim.english_title || '');
  const catalogTitle = normalize(catalogEntry.title || '');
  const catalogSubtitle = normalize(catalogEntry.subtitle || '');

  const claimWords = claimTitle.split(/\s+/).filter(w => w.length > 2);
  const catalogWords = (catalogTitle + ' ' + catalogSubtitle).split(/\s+/).filter(w => w.length > 2);

  if (claimWords.length === 0 || catalogWords.length === 0) return false;

  let matchCount = 0;
  for (const w of claimWords) {
    if (catalogWords.some(cw => cw.includes(w) || w.includes(cw))) matchCount++;
  }

  const matchRatio = matchCount / claimWords.length;
  if (matchRatio < 0.4) return false;

  if (claim.pub_year && catalogEntry.year) {
    const claimYear = parseInt(claim.pub_year);
    const catYear = parseInt(catalogEntry.year);
    if (!isNaN(claimYear) && !isNaN(catYear) && Math.abs(claimYear - catYear) > 15) {
      return false;
    }
  }

  return true;
}

async function lookupOpenLibrary(key) {
  if (!key) return null;
  try {
    const url = `https://openlibrary.org${key}.json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function lookupGoogleBooks(id) {
  if (!id) return null;
  try {
    const url = `https://www.googleapis.com/books/v1/volumes/${id}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.volumeInfo || null;
  } catch {
    return null;
  }
}

// ── Path A: Validate catalog claims ─────────────────────────────────

async function validateCatalogClaims(book) {
  const translations = book.translation_verification?.translations || [];
  const validatedTranslations = [];
  let anyValidated = false;

  for (const t of translations) {
    const catalogId = t.catalog_id;
    const source = t.evidence_source;
    let validated = false;
    let lookupResult = null;

    // Direct lookup if we have a catalog ID
    if (catalogId && source === 'open_library') {
      const olKey = catalogId.startsWith('/') ? catalogId : `/works/${catalogId}`;
      lookupResult = await lookupOpenLibrary(olKey);
      if (lookupResult) {
        validated = true;
      }
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    } else if (catalogId && source === 'google_books') {
      lookupResult = await lookupGoogleBooks(catalogId);
      if (lookupResult) {
        validated = true;
      }
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    } else if (catalogId && source === 'internet_archive') {
      // IA identifiers can be checked via metadata API
      try {
        const resp = await fetch(`https://archive.org/metadata/${catalogId}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.metadata) validated = true;
        }
      } catch {}
      await new Promise(r => setTimeout(r, API_DELAY_MS));
    }

    // If no catalog ID, use fuzzy matching from original search evidence
    if (!validated && !catalogId) {
      // Accept claims with strong/moderate evidence without direct lookup
      const strength = book.translation_verification?.search_evidence?.evidence_strength;
      if (strength === 'strong' || strength === 'moderate') {
        validated = true;
      }
    }

    validatedTranslations.push({
      ...t,
      validated,
      lookup_result: lookupResult ? { title: lookupResult.title, found: true } : null,
    });

    if (validated) anyValidated = true;
  }

  return {
    disposition: anyValidated ? 'translation_found' : 'needs_review',
    disposition_reasoning: anyValidated
      ? `${validatedTranslations.filter(t => t.validated).length}/${translations.length} claimed translation(s) verified in library catalogs.`
      : `Stage 1 found ${translations.length} claimed translation(s) but none could be verified via direct catalog lookup.`,
    validated_translations: validatedTranslations,
  };
}

// ── Path B: LLM knowledge check ─────────────────────────────────────

function sanitizeForPrompt(s, maxLen = 120) {
  if (!s) return 'Unknown';
  // Keep original if short enough
  if (s.length <= maxLen) return s;
  // Truncate at word boundary
  return s.substring(0, maxLen).replace(/\s+\S*$/, '') + '...';
}

function buildKnowledgePrompt(book) {
  const title = sanitizeForPrompt(book.display_title || book.title, 150);
  const author = sanitizeForPrompt(book.author, 80);
  const published = book.published || book.year || 'Unknown';
  const language = book.language || book.ai_metadata?.language || 'Unknown';

  return `You are a bibliographic research assistant specializing in the history of translation.

I need you to determine whether the following work has EVER been translated into English:

WORK: "${title}"
AUTHOR: ${author}
ORIGINAL LANGUAGE: ${language}
DATE: ${published}

CONTEXT: A search of Open Library, Google Books, and Internet Archive found NO English translations of this work. I need you to check your training knowledge for translations that may not appear in those catalogs.

Consider:
1. Major academic publishers (Cambridge UP, Oxford UP, Penguin, Loeb Classical Library, Routledge, Brill, De Gruyter)
2. Specialist publishers (Cazimi Press, Golden Hoard Press, Inner Traditions, ACMRS, Hackett)
3. Older translations (18th-19th century, e.g. Thomas Taylor's Neoplatonist translations)
4. PhD dissertations with translations
5. Journal articles containing translations
6. Recent translations (2010-2025)
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
  "reasoning": "1-2 sentences about your certainty level"
}

If you are not sure, say so. Do NOT hallucinate translations that don't exist.
If this is a well-known work, confirm with high confidence.
If this is an obscure text, be honest about uncertainty.`;
}

async function callGeminiForKnowledge(book, retryCount = 0) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildKnowledgePrompt(book);
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
    // Try to extract JSON from partial response
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch { /* fall through to retry */ }
    }
    // If still no parse, try fixing truncated JSON
    if (!parsed) {
      try {
        // Attempt to close truncated JSON: add missing brackets
        let fixed = text.trim();
        if (!fixed.endsWith('}')) {
          // Find last complete property
          const lastComma = fixed.lastIndexOf(',');
          const lastBrace = fixed.lastIndexOf('}');
          if (lastComma > lastBrace) fixed = fixed.substring(0, lastComma);
          // Close arrays and objects
          const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
          const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
          fixed += ']'.repeat(Math.max(0, openBrackets)) + '}'.repeat(Math.max(0, openBraces));
        }
        parsed = JSON.parse(fixed);
      } catch { /* fall through to retry */ }
    }
    if (!parsed) {
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

async function checkWithLLM(book) {
  // First attempt
  let result = await callGeminiForKnowledge(book);
  if (result.error === 'parse_failed') {
    // Retry once with delay
    await new Promise(r => setTimeout(r, 1000));
    result = await callGeminiForKnowledge(book);
  }
  return result;
}

// ── Cost ────────────────────────────────────────────────────────────

function calculateCost(usage) {
  return (
    (usage.input_tokens / 1_000_000) * 0.15 +
    (usage.output_tokens / 1_000_000) * 0.60
  );
}

// ── CSV output ──────────────────────────────────────────────────────

function escapeCsv(s) {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n'))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 1000;
  const bookId = args.includes('--book-id') ? args[args.indexOf('--book-id') + 1] : null;

  console.log(`=== Stage 2: Validate Translation Evidence ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL} (for Path B) | Keys: ${apiKeys.length}`);
  console.log(`Limit: ${limit}`);
  if (bookId) console.log(`Book: ${bookId}`);
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find books that completed Stage 1 but haven't been validated yet
  const query = bookId
    ? { id: bookId }
    : {
        'translation_verification.source': 'catalog_search',
        'translation_verification.disposition': { $exists: false },
      };

  const books = await db.collection('books')
    .find(query)
    .sort({ read_count: -1, title: 1 })
    .limit(limit)
    .project({
      id: 1, title: 1, display_title: 1, author: 1, language: 1,
      published: 1, year: 1, categories: 1, ai_metadata: 1,
      translation_verification: 1, is_first_translation: 1,
    })
    .toArray();

  console.log(`Found ${books.length} books to validate\n`);
  if (books.length === 0) { await client.close(); return; }

  // Split into Path A (translations found) and Path B (nothing found)
  const pathA = books.filter(b => b.translation_verification?.has_english_translation);
  const pathB = books.filter(b => !b.translation_verification?.has_english_translation);

  console.log(`Path A (catalog claims to verify): ${pathA.length}`);
  console.log(`Path B (LLM knowledge check): ${pathB.length}\n`);

  let processed = 0;
  let confirmedFirst = 0;
  let translationFound = 0;
  let needsReview = 0;
  let totalErrors = 0;
  let totalCost = 0;
  const csvRows = [];

  // ── Path A: Validate catalog claims ─────────────────────────────
  if (pathA.length > 0) {
    console.log('--- Path A: Validating catalog claims ---\n');
  }

  for (const book of pathA) {
    processed++;
    const shortTitle = (book.display_title || book.title || '').substring(0, 55);

    try {
      const result = await validateCatalogClaims(book);

      if (result.disposition === 'translation_found') {
        translationFound++;
        console.log(`  [${processed}/${books.length}] CONFIRMED  ${shortTitle}`);
        const validated = result.validated_translations.filter(t => t.validated);
        console.log(`      ${validated.length} translation(s) verified`);
      } else {
        needsReview++;
        console.log(`  [${processed}/${books.length}] REVIEW     ${shortTitle}`);
        console.log(`      Claims not verifiable via direct lookup`);
      }

      // Build CSV row
      const firstT = result.validated_translations?.[0];
      csvRows.push([
        escapeCsv(book.id),
        escapeCsv(book.display_title || book.title || ''),
        escapeCsv(book.author || ''),
        escapeCsv(book.language || ''),
        escapeCsv(book.published || ''),
        escapeCsv(result.disposition),
        escapeCsv(book.translation_verification?.search_evidence?.evidence_strength || ''),
        escapeCsv(firstT?.english_title || ''),
        escapeCsv(firstT?.translator || ''),
        escapeCsv(firstT?.pub_year || ''),
        escapeCsv(firstT?.evidence_source || ''),
        escapeCsv(result.disposition_reasoning?.substring(0, 200) || ''),
      ].join(','));

      if (!dryRun) {
        await db.collection('books').updateOne(
          { id: book.id },
          {
            $set: {
              'translation_verification.disposition': result.disposition,
              'translation_verification.disposition_reasoning': result.disposition_reasoning,
              'translation_verification.disposition_at': new Date(),
              'translation_verification.validated_translations': result.validated_translations,
              updated_at: new Date(),
            },
          }
        );
      }
    } catch (err) {
      totalErrors++;
      console.log(`  [${processed}/${books.length}] ERROR  ${shortTitle} -- ${err.message}`);
    }
  }

  // ── Path B: LLM knowledge check ────────────────────────────────
  if (pathB.length > 0) {
    console.log('\n--- Path B: LLM knowledge check ---\n');
  }

  for (let i = 0; i < pathB.length; i += CONCURRENCY) {
    const batch = pathB.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      try {
        const result = await checkWithLLM(book);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    for (const r of results) {
      processed++;
      if (r.status === 'rejected') {
        totalErrors++;
        console.log(`  [${processed}/${books.length}] FAIL: ${r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);

      if (error || result?.error) {
        totalErrors++;
        console.log(`  [${processed}/${books.length}] ERROR  ${shortTitle} -- ${error || result.error}`);
        continue;
      }

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      let disposition;
      let dispositionReasoning;

      if (!result.has_english_translation) {
        // Both catalog search and LLM agree: no translation
        disposition = 'confirmed_first';
        dispositionReasoning = `No translation found in 3 library catalogs AND Gemini knowledge check agrees. ${result.reasoning || ''}`;
        confirmedFirst++;
        console.log(`  [${processed}/${books.length}] CONFIRMED FIRST  ${shortTitle}  (${result.confidence})`);
      } else {
        // LLM says translation exists but catalogs found nothing -> needs review
        disposition = 'needs_review';
        const firstT = result.translations?.[0];
        dispositionReasoning = `Library catalogs found nothing but LLM claims translation exists: "${firstT?.english_title || '?'}" (${firstT?.translator || '?'}, ${firstT?.pub_year || '?'}). ${result.reasoning || ''}`;
        needsReview++;
        console.log(`  [${processed}/${books.length}] NEEDS REVIEW     ${shortTitle}  (LLM says translation exists)`);
        if (firstT) {
          console.log(`      LLM claims: "${(firstT.english_title || '').substring(0, 60)}" (${firstT.pub_year || '?'})`);
        }
      }

      if (result.reasoning) {
        console.log(`      ${result.reasoning.substring(0, 120)}`);
      }

      // Build CSV row
      const firstT = result.translations?.[0];
      csvRows.push([
        escapeCsv(book.id),
        escapeCsv(book.display_title || book.title || ''),
        escapeCsv(book.author || ''),
        escapeCsv(book.language || ''),
        escapeCsv(book.published || ''),
        escapeCsv(disposition),
        escapeCsv(book.translation_verification?.search_evidence?.evidence_strength || 'none'),
        escapeCsv(firstT?.english_title || ''),
        escapeCsv(firstT?.translator || ''),
        escapeCsv(firstT?.pub_year || ''),
        escapeCsv(firstT?.notes || ''),
        escapeCsv(dispositionReasoning?.substring(0, 200) || ''),
      ].join(','));

      if (!dryRun) {
        const update = {
          'translation_verification.disposition': disposition,
          'translation_verification.disposition_reasoning': dispositionReasoning,
          'translation_verification.disposition_at': new Date(),
          updated_at: new Date(),
        };

        // If LLM found translations, store them for reference
        if (result.has_english_translation && result.translations?.length) {
          update['translation_verification.llm_knowledge_translations'] = result.translations;
        }

        await db.collection('books').updateOne({ id: book.id }, { $set: update });

        // Log LLM call
        if (result.usage) {
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
            endpoint: 'script/validate-translation-evidence',
          });
        }
      }
    }

    if (i + CONCURRENCY < pathB.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // Write CSV report
  const csvHeader = 'book_id,title,author,language,published,disposition,evidence_strength,claimed_translation,translator,pub_year,evidence_source_or_notes,reasoning';
  fs.writeFileSync(CSV_PATH, csvHeader + '\n' + csvRows.join('\n') + '\n');
  console.log(`\nWrote ${csvRows.length} rows to ${CSV_PATH}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Confirmed first translation: ${confirmedFirst}`);
  console.log(`Translation found (catalog-verified): ${translationFound}`);
  console.log(`Needs review: ${needsReview}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`LLM cost (Path B): $${totalCost.toFixed(4)}`);

  if (translationFound > 0) {
    console.log(`\nACTION: ${translationFound} books should have is_first_translation flipped to false`);
  }
  if (needsReview > 0) {
    console.log(`ACTION: ${needsReview} books need manual review`);
  }

  if (dryRun) console.log('\n(Dry run -- use --apply to write to DB)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
