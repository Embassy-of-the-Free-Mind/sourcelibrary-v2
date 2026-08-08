#!/usr/bin/env node
/**
 * Stage 3: Search-based verification of needs_review translation claims.
 *
 * Two tiers:
 *   Tier 1 (free):  Match Latin books against UNESCO Index Translationum master CSV (7,542 records)
 *   Tier 2 (~$0.014/book): Gemini 3 Flash with Google Search grounding — model actually searches the web
 *
 * Updates disposition to:
 *   - translation_found: real evidence found (UNESCO match or grounded search result with URLs)
 *   - confirmed_first: searched and found nothing
 *   - needs_review: search was inconclusive (stays for manual review)
 *
 * Usage:
 *   node scripts/enrichment/verify-translation-claims.mjs --dry-run
 *   node scripts/enrichment/verify-translation-claims.mjs --dry-run --limit 20
 *   node scripts/enrichment/verify-translation-claims.mjs --apply
 *   node scripts/enrichment/verify-translation-claims.mjs --apply --tier1-only   # UNESCO only, skip search
 *   node scripts/enrichment/verify-translation-claims.mjs --apply --tier2-only   # Search only, skip UNESCO
 *   node scripts/enrichment/verify-translation-claims.mjs --apply --all-latin   # UNESCO+search on ALL Latin books (not just needs_review)
 *   node scripts/enrichment/verify-translation-claims.mjs --apply --all-latin --tier1-only  # UNESCO only on ALL Latin books (free)
 *   node scripts/enrichment/verify-translation-claims.mjs --apply --book-id BOOK_ID
 */

import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { createRequire } from 'module';

// ── Config ──────────────────────────────────────────────────────────
const SEARCH_MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 2;         // grounded queries are slower + network-sensitive
const DELAY_MS = 1000;         // respect rate limits
const MAX_RETRIES = 2;         // retry on network failures
const UNESCO_CSV = '/Users/dereklomas/secondrenaissance/scripts/latin_translations_master.csv';

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

function getNextKey() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return key;
}

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const TIER1_ONLY = args.includes('--tier1-only');
const TIER2_ONLY = args.includes('--tier2-only');
const ALL_LATIN = args.includes('--all-latin');
const SKIP_NEEDS_REVIEW = args.includes('--skip-needs-review');
function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const OFFSET = getArg('--offset') ? parseInt(getArg('--offset')) : 0;
const BOOK_ID = getArg('--book-id');

// ══════════════════════════════════════════════════════════════════════
// TIER 1: UNESCO / Publisher Master CSV Lookup
// ══════════════════════════════════════════════════════════════════════

function loadUnescoCSV() {
  try {
    const content = fs.readFileSync(UNESCO_CSV, 'utf8');
    const lines = content.split('\n');
    const header = lines[0].split(',');
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Simple CSV parse (handles quoted fields)
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
        current += ch;
      }
      fields.push(current);

      const record = {};
      for (let j = 0; j < header.length; j++) {
        record[header[j].trim()] = (fields[j] || '').trim();
      }
      records.push(record);
    }

    return records;
  } catch (err) {
    console.warn(`Warning: Could not load UNESCO CSV: ${err.message}`);
    return [];
  }
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchBookToUNESCO(book, unescoRecords, { relaxed = false } = {}) {
  const bookAuthor = normalize(book.author);
  const bookTitle = normalize(book.title);
  const bookDisplayTitle = normalize(book.display_title || '');

  // Thresholds: relaxed mode widens the net for --all-latin
  const MIN_SURNAME_LEN = relaxed ? 4 : 5;
  const MIN_WORD_LEN = relaxed ? 4 : 3;  // for title word filtering (> this value)
  const SCORE_THRESHOLD = relaxed ? 0.4 : 0.5;

  // Extract key author surname(s) for matching
  const authorWords = bookAuthor.split(' ').filter(w => w.length > 2);

  const matches = [];

  for (const rec of unescoRecords) {
    const recAuthor = normalize(rec.canonical_author || rec.author);
    const recTitle = normalize(rec.canonical_work || rec.original_title);
    const recEnglish = normalize(rec.english_title);

    // Author match: require the SURNAME to match, not just any shared first name
    // Fixes: "Julius Firmicus Maternus" ≠ "Julius Caesar", "Heinrich Khunrath" ≠ "Heinrich Suso"
    const recAuthorWords = recAuthor.split(' ').filter(w => w.length > 2);
    const significantAuthorWords = authorWords.filter(w => w.length > 2);
    if (significantAuthorWords.length === 0 || recAuthorWords.length === 0) continue;

    // Find the most distinctive word — prefer LAST word (surname convention), then longest
    // "Heinrich Khunrath" → "khunrath" (last), not "heinrich" (same length but first name)
    const sortedByLen = [...significantAuthorWords].sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      // Same length: prefer the one that appears LATER in the name (surname)
      return significantAuthorWords.indexOf(b) - significantAuthorWords.indexOf(a);
    });
    const surname = sortedByLen[0];

    // Skip for very short surnames — too many false positives
    if (surname.length < MIN_SURNAME_LEN) continue;

    // In relaxed mode, require exact match for short surnames (4 chars) — no substring
    const surnameMatches = recAuthorWords.some(rw => {
      if (rw === surname) return true;
      if (surname.length >= 5) return rw.includes(surname) || surname.includes(rw);
      return false; // 4-char surnames: exact only
    });
    if (!surnameMatches) continue;

    // Title match: check overlap between book title and record original/canonical title
    // In relaxed mode, use longer minimum word length to avoid false substring matches
    const titleWords = bookTitle.split(' ').filter(w => w.length > MIN_WORD_LEN);
    const recTitleWords = recTitle.split(' ').filter(w => w.length > MIN_WORD_LEN);
    const displayTitleWords = bookDisplayTitle.split(' ').filter(w => w.length > MIN_WORD_LEN);

    let titleMatchCount = 0;
    for (const w of titleWords) {
      if (recTitleWords.some(rw => rw.includes(w) || w.includes(rw))) titleMatchCount++;
    }
    // Also check display title (English) against english_title
    let displayMatchCount = 0;
    const recEnglishWords = recEnglish.split(' ').filter(w => w.length > MIN_WORD_LEN);
    for (const w of displayTitleWords) {
      if (recEnglishWords.some(rw => rw.includes(w) || w.includes(rw))) displayMatchCount++;
    }

    const titleScore = titleWords.length > 0 ? titleMatchCount / titleWords.length : 0;
    const displayScore = displayTitleWords.length > 0 ? displayMatchCount / displayTitleWords.length : 0;
    const bestScore = Math.max(titleScore, displayScore);

    if (bestScore >= SCORE_THRESHOLD) {
      matches.push({
        score: bestScore,
        record: rec,
      });
    }
  }

  // Sort by match quality
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 5); // top 5 matches
}

// ══════════════════════════════════════════════════════════════════════
// TIER 2: Gemini with Google Search Grounding
// ══════════════════════════════════════════════════════════════════════

function buildSearchPrompt(book) {
  const title = (book.display_title || book.title || '').substring(0, 200);
  const originalTitle = book.title ? book.title.substring(0, 200) : '';
  const author = (book.author || 'Unknown').substring(0, 100);
  const language = book.language || 'Unknown';
  const published = book.published || 'Unknown';

  // Include existing LLM claims as search hints
  const claims = book.translation_verification?.llm_knowledge_translations || [];
  let claimHints = '';
  if (claims.length > 0) {
    const hints = claims
      .filter(c => c.translator && !['various', 'multiple', 'anonymous'].some(v => (c.translator || '').toLowerCase().includes(v)))
      .slice(0, 3)
      .map(c => `- "${c.english_title || '?'}" by ${c.translator || '?'} (${c.pub_year || '?'})`)
      .join('\n');
    if (hints) {
      claimHints = `\n\nA previous AI suggested these might exist (UNVERIFIED — may be hallucinated):\n${hints}\nPlease search to confirm or deny these specific claims.`;
    }
  }

  // UNESCO hint from Tier 1 medium-confidence match
  let unescoHint = '';
  if (book._unescoHint) {
    const h = book._unescoHint;
    unescoHint = `\n\nA UNESCO/publisher catalog suggests this translation might exist (needs verification):\n- "${h.english_title}" by ${h.translator} (${h.pub_year})\nPlease search to confirm this specific edition.`;
  }

  return `Search for published English TRANSLATIONS of this historical text.

Title: "${title}"${originalTitle && originalTitle !== title ? `\nOriginal title: "${originalTitle}"` : ''}
Author: ${author}
Original language: ${language}
Published: ${published}
${claimHints}${unescoHint}

IMPORTANT DISTINCTIONS:
- A TRANSLATION is a book that renders the original text into English. Look for a named translator.
- A scholarly STUDY or monograph ABOUT the work is NOT a translation (e.g., "Athanasius Kircher and the Secrets of Antiquity" is a study, not a translation).
- A translation must contain the actual text of the original work in English, not just discuss it.
- Partial translations (e.g., one chapter translated in a dissertation) DO count — note them as "partial" or "excerpts".
- IGNORE results from sourcelibrary.org — that is our own project, not a prior translation.

Search for:
1. Published English translations (complete or partial) with a named translator
2. Bilingual editions (Latin/English, etc.)
3. PhD dissertations that include a translation of the text
4. Anthology/excerpt translations

For each GENUINE TRANSLATION found, provide:
- English title
- Translator name (required — if no translator named, it's probably not a translation)
- Publication year
- Publisher
- Whether it's complete, partial, or excerpts
- A URL if available

If you find only scholarly studies ABOUT the work but no actual translations, report translations_found: false.

Respond JSON only:
{
  "translations_found": true/false,
  "translations": [
    {
      "english_title": "...",
      "translator": "...",
      "pub_year": "...",
      "publisher": "...",
      "completeness": "complete|partial|excerpts",
      "url": "...",
      "notes": "..."
    }
  ],
  "confidence": "high|medium|low",
  "reasoning": "1-2 sentences summarizing what the search found"
}`;
}

async function searchWithGrounding(book) {
  const prompt = buildSearchPrompt(book);

  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const key = getNextKey();
      const ai = new GoogleGenAI({ apiKey: key });

      response = await ai.models.generateContent({
        model: SEARCH_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1,
        },
      });
      break; // success
    } catch (err) {
      if (attempt < MAX_RETRIES && (err.message.includes('fetch failed') || err.message.includes('ECONNRESET') || err.message.includes('timeout'))) {
        const wait = (attempt + 1) * 2000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  const text = response.text || '';
  const usage = response.usageMetadata || {};

  // Extract grounding metadata
  const candidate = response.candidates?.[0];
  const groundingMeta = candidate?.groundingMetadata;
  const searchQueries = groundingMeta?.webSearchQueries || [];
  const groundingChunks = groundingMeta?.groundingChunks || [];
  const urls = groundingChunks
    .filter(c => c.web?.uri)
    .map(c => ({ url: c.web.uri, title: c.web.title || '' }));

  // Parse JSON response
  let parsed;
  try {
    // Model may include markdown backticks around JSON
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to extract any JSON object
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (!parsed) {
      return {
        error: 'parse_failed',
        raw: text.substring(0, 500),
        searchQueries,
        urls,
      };
    }
  }

  return {
    ...parsed,
    searchQueries,
    urls,
    tokens: {
      input: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
    },
  };
}

// ── Batch processor ─────────────────────────────────────────────────

async function processInBatches(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Stage 3: Search-Based Translation Verification ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}`);
  if (ALL_LATIN) console.log('Scope: ALL Latin books (relaxed UNESCO matching)');
  if (TIER1_ONLY) console.log('Tier: UNESCO lookup only (free)');
  else if (TIER2_ONLY) console.log('Tier: Google Search grounding only');
  else console.log(`Tiers: UNESCO lookup (free) + Google Search grounding (${SEARCH_MODEL})`);
  console.log(`API keys: ${apiKeys.length}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  if (OFFSET) console.log(`Offset: ${OFFSET}`);
  if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);
  console.log();

  // Load UNESCO data
  let unescoRecords = [];
  if (!TIER2_ONLY) {
    unescoRecords = loadUnescoCSV();
    console.log(`Loaded ${unescoRecords.length} UNESCO/publisher translation records`);
  }

  // Connect to MongoDB (SRV workaround for local DNS timeout)
  let uri = MONGODB_URI;
  if (uri.startsWith('mongodb+srv://')) {
    uri = uri.replace('mongodb+srv://', 'mongodb://').replace(
      'research-apps.ywilvpy.mongodb.net',
      'ac-h0wyqwh-shard-00-00.ywilvpy.mongodb.net:27017,ac-h0wyqwh-shard-00-01.ywilvpy.mongodb.net:27017,ac-h0wyqwh-shard-00-02.ywilvpy.mongodb.net:27017'
    );
    if (!uri.includes('tls=')) uri += '&tls=true';
    if (!uri.includes('authSource=')) uri += '&authSource=admin';
    if (!uri.includes('replicaSet=')) uri += '&replicaSet=atlas-hzh32c-shard-0';
  }
  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find target books
  let query;
  if (BOOK_ID) {
    query = { id: BOOK_ID };
  } else if (ALL_LATIN) {
    // All Latin books, excluding those already verified by search grounding or UNESCO CSV
    const orConditions = [
      { 'translation_verification.disposition': { $exists: false } },  // never checked
      {
        'translation_verification.disposition': 'confirmed_first',
        'translation_verification.cross_model_verification.method': { $exists: false },  // LLM prediction, not search-verified
      },
    ];
    if (!SKIP_NEEDS_REVIEW) {
      orConditions.push({ 'translation_verification.disposition': 'needs_review' });  // pending review
    }
    query = {
      language: { $regex: /latin/i },
      $or: orConditions,
    };
  } else {
    query = { 'translation_verification.disposition': 'needs_review' };
  }

  const totalCount = await db.collection('books').countDocuments(query);
  console.log(`Found ${totalCount} ${ALL_LATIN ? 'Latin' : 'needs_review'} books total`);

  const cursor = db.collection('books')
    .find(query, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, translation_verification: 1,
      },
    })
    .sort({ read_count: -1, created_at: 1 })
    .skip(OFFSET);

  if (LIMIT) cursor.limit(LIMIT);

  const books = await cursor.toArray();
  console.log(`Processing ${books.length} books\n`);

  // Stats
  let tier1Matched = 0;
  let tier2Searched = 0;
  let confirmedFirst = 0;
  let firstFullTranslation = 0;  // partial/excerpt translations exist, but ours is the first complete one
  let translationFound = 0;
  let stillNeedsReview = 0;
  let errors = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let searchQueries = 0;

  // ── TIER 1: UNESCO Lookup ──────────────────────────────────────────
  const tier2Queue = [];  // books that need search grounding

  if (!TIER2_ONLY && unescoRecords.length > 0) {
    console.log('── Tier 1: UNESCO / Publisher CSV Lookup ──\n');

    for (const book of books) {
      const title = (book.display_title || book.title || '').substring(0, 55);
      const lang = (book.language || '').toLowerCase();

      // Only match Latin books against the Latin-to-English CSV
      if (!lang.includes('latin')) {
        tier2Queue.push(book);
        continue;
      }

      const matches = matchBookToUNESCO(book, unescoRecords, { relaxed: ALL_LATIN });

      // In all-latin mode: high-confidence matches (>=0.6) apply directly;
      // medium matches (0.4-0.59) queue for Tier 2 verification
      const applyThreshold = 0.6;

      if (matches.length > 0 && matches[0].score >= applyThreshold) {
        tier1Matched++;
        translationFound++;
        const best = matches[0].record;
        const reasoning = `UNESCO/publisher CSV match (score: ${matches[0].score.toFixed(2)}): "${best.english_title}" by ${best.translator} (${best.pub_year}, ${best.publisher}). Source: ${best.source}`;

        console.log(`  UNESCO MATCH  ${title}`);
        console.log(`    → "${(best.english_title || '').substring(0, 70)}" by ${best.translator} (${best.pub_year})`);

        if (!DRY_RUN) {
          const unescoTranslations = matches.slice(0, 3).map(m => ({
            english_title: m.record.english_title,
            translator: m.record.translator,
            pub_year: m.record.pub_year,
            publisher: m.record.publisher,
            completeness: 'unknown',
            evidence_source: `unesco_csv:${m.record.source}`,
            validated: true,
            notes: `UNESCO/publisher CSV match (score: ${m.score.toFixed(2)}). Series: ${m.record.series || 'none'}`,
          }));

          await db.collection('books').updateOne({ id: book.id }, {
            $set: {
              'translation_verification.disposition': 'translation_found',
              'translation_verification.disposition_reasoning': reasoning,
              'translation_verification.disposition_at': new Date(),
              'translation_verification.validated_translations': unescoTranslations,
              'translation_verification.cross_model_verification': {
                method: 'unesco_csv_lookup',
                verified_at: new Date(),
                match_score: matches[0].score,
              },
              // No is_first_translation write: a title-match score is a lead, not a
              // verified demotion. The badge is owned by reconcile-first-translation-flag.ts (#3726).
              updated_at: new Date(),
            },
          });
        }
      } else if (ALL_LATIN && matches.length > 0 && matches[0].score >= 0.4) {
        // Medium-confidence UNESCO match — queue for Tier 2 with UNESCO hint
        const best = matches[0].record;
        book._unescoHint = {
          score: matches[0].score,
          english_title: best.english_title,
          translator: best.translator,
          pub_year: best.pub_year,
        };
        tier2Queue.push(book);
        console.log(`  UNESCO HINT ${title} (score: ${matches[0].score.toFixed(2)}) → queued for search`);
        console.log(`    Possible: "${(best.english_title || '').substring(0, 70)}" by ${best.translator}`);
      } else {
        // No UNESCO match — queue for search grounding
        tier2Queue.push(book);
      }
    }

    console.log(`\nTier 1 results: ${tier1Matched} matched, ${tier2Queue.length} queued for search\n`);
  } else {
    tier2Queue.push(...books);
  }

  // ── TIER 2: Google Search Grounding ────────────────────────────────

  if (!TIER1_ONLY && tier2Queue.length > 0) {
    console.log('── Tier 2: Google Search Grounding ──\n');

    const results = await processInBatches(tier2Queue, async (book) => {
      const title = (book.display_title || book.title || '').substring(0, 55);

      try {
        const result = await searchWithGrounding(book);

        if (result.error) {
          errors++;
          console.log(`  ERROR      ${title} — ${result.error}`);
          if (result.searchQueries?.length) console.log(`    Searched: ${result.searchQueries.join(', ')}`);
          return result;
        }

        totalTokensIn += (result.tokens?.input || 0);
        totalTokensOut += (result.tokens?.output || 0);
        searchQueries += (result.searchQueries?.length || 0);
        tier2Searched++;

        let disposition;
        let reasoning;

        // Filter out self-references (Source Library's own translations)
        if (result.translations?.length) {
          result.translations = result.translations.filter(t => {
            const translator = (t.translator || '').toLowerCase();
            const url = (t.url || '').toLowerCase();
            const publisher = (t.publisher || '').toLowerCase();
            const title = (t.english_title || '').toLowerCase();
            if (translator.includes('derek lim') || translator.includes('derek lomas')) return false;
            if (url.includes('sourcelibrary.org') || url.includes('source library')) return false;
            if (publisher.includes('source library')) return false;
            if (title.includes('source library')) return false;
            return true;
          });
          if (result.translations.length === 0) result.translations_found = false;
        }

        if (result.translations_found && result.translations?.length > 0) {
          // Check if ALL translations are only partial/excerpts (no complete ones)
          const allPartial = result.translations.every(t =>
            t.completeness === 'partial' || t.completeness === 'excerpts'
          );
          const first = result.translations[0];

          if (allPartial) {
            // Only partial/excerpt translations exist — this IS the first FULL translation
            disposition = 'translation_found';  // translations do exist (partial)
            firstFullTranslation++;
            const partialList = result.translations.map(t =>
              `${t.translator || '?'} (${t.pub_year || '?'}, ${t.completeness})`
            ).join('; ');
            reasoning = `First full English translation. Only partial/excerpt translations previously existed: ${partialList}. ${result.reasoning || ''}`;

            console.log(`  FIRST-FULL ${title}`);
            console.log(`    Previous partials: ${partialList.substring(0, 120)}`);
          } else {
            disposition = 'translation_found';
            translationFound++;
            reasoning = `Google Search grounding found translation: "${first.english_title}" by ${first.translator} (${first.pub_year}). ${result.reasoning || ''}`;

            console.log(`  FOUND      ${title}`);
            console.log(`    → "${(first.english_title || '').substring(0, 70)}" by ${first.translator || '?'} (${first.pub_year || '?'})`);
          }
          if (result.urls?.length) {
            console.log(`    URLs: ${result.urls.slice(0, 2).map(u => u.url).join(', ')}`);
          }
        } else {
          disposition = 'confirmed_first';
          confirmedFirst++;
          reasoning = `Google Search grounding found no English translations. Searched: ${(result.searchQueries || []).join('; ')}. ${result.reasoning || ''}`;

          console.log(`  FIRST      ${title}`);
          if (result.reasoning) console.log(`    ${result.reasoning.substring(0, 120)}`);
        }

        if (!DRY_RUN) {
          const update = {
            'translation_verification.disposition': disposition,
            'translation_verification.disposition_reasoning': reasoning,
            'translation_verification.disposition_at': new Date(),
            'translation_verification.cross_model_verification': {
              model: SEARCH_MODEL,
              method: 'google_search_grounding',
              verified_at: new Date(),
              search_queries: result.searchQueries || [],
              grounding_urls: (result.urls || []).slice(0, 10),
              confidence: result.confidence,
            },
            updated_at: new Date(),
          };

          if (disposition === 'translation_found' && result.translations?.length) {
            update['translation_verification.validated_translations'] = result.translations.map(t => ({
              english_title: t.english_title,
              translator: t.translator,
              pub_year: t.pub_year,
              publisher: t.publisher,
              completeness: t.completeness || 'unknown',
              evidence_source: 'google_search_grounding',
              validated: true,
              notes: t.notes || t.url || '',
            }));
          }

          // No is_first_translation write here: grounded search output is evidence,
          // not a verdict — promotions and demotions of the public badge flow through
          // reconcile-first-translation-flag.ts only (#3726).
          await db.collection('books').updateOne({ id: book.id }, { $set: update });

          // Log AI usage
          await db.collection('gemini_usage').insertOne({
            timestamp: new Date(),
            type: 'other',
            mode: 'realtime',
            model: SEARCH_MODEL,
            book_id: book.id,
            book_title: book.display_title || book.title,
            input_tokens: result.tokens?.input || 0,
            output_tokens: result.tokens?.output || 0,
            cost_usd: ((result.tokens?.input || 0) / 1_000_000) * 0.15 +
                      ((result.tokens?.output || 0) / 1_000_000) * 3.50,
            status: 'success',
            endpoint: 'script/verify-translation-claims',
          });
        }

        return result;
      } catch (err) {
        errors++;
        console.log(`  ERROR      ${title} — ${err.message}`);
        return { error: err.message };
      }
    }, CONCURRENCY);
  }

  // ── Summary ────────────────────────────────────────────────────────

  // Grounding cost estimate: $14/1K queries for Gemini 3 Flash
  const groundingCost = tier2Searched * 0.014;
  const tokenCostIn = (totalTokensIn / 1_000_000) * 0.15;
  const tokenCostOut = (totalTokensOut / 1_000_000) * 3.50;
  const totalCost = groundingCost + tokenCostIn + tokenCostOut;

  console.log('\n── Summary ──');
  console.log(`Total processed: ${books.length}`);
  console.log(`  Tier 1 (UNESCO CSV): ${tier1Matched} matched`);
  console.log(`  Tier 2 (Search): ${tier2Searched} searched (${searchQueries} Google queries)`);
  console.log();
  console.log('Results:');
  console.log(`  Translation found (complete): ${translationFound}`);
  console.log(`  First full translation (only partials exist): ${firstFullTranslation}`);
  console.log(`  Confirmed first (no translations found): ${confirmedFirst}`);
  console.log(`  Still needs review: ${stillNeedsReview}`);
  console.log(`  Errors: ${errors}`);
  console.log();
  console.log(`Tokens: ${totalTokensIn.toLocaleString()} in / ${totalTokensOut.toLocaleString()} out`);
  console.log(`Est. cost: $${totalCost.toFixed(2)} (grounding: $${groundingCost.toFixed(2)}, tokens: $${(tokenCostIn + tokenCostOut).toFixed(2)})`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLIED'}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
