#!/usr/bin/env node
/**
 * Stage 1: Search library catalogs for English translations of "first translation" books.
 *
 * Queries Open Library, Google Books, and Internet Archive for each book marked
 * `is_first_translation: true`, then uses Gemini to synthesize results into
 * structured evidence stored in `book.translation_verification`.
 *
 * Usage:
 *   node scripts/enrichment/search-translation-evidence.mjs --dry-run
 *   node scripts/enrichment/search-translation-evidence.mjs --apply --limit 20
 *   node scripts/enrichment/search-translation-evidence.mjs --apply
 *   node scripts/enrichment/search-translation-evidence.mjs --apply --book-id BOOK_ID
 *   node scripts/enrichment/search-translation-evidence.mjs --apply --offset 100 --limit 50
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 3;
const API_DELAY_MS = 400;
const BATCH_DELAY_MS = 300;

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

// ── Catalog search helpers ──────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function extractSurname(authorStr) {
  if (!authorStr) return '';
  const comma = authorStr.indexOf(',');
  let name = comma > 0 ? authorStr.substring(0, comma) : authorStr;
  name = name.replace(/\b(saint|st\.?|von|de|van|del|di|da|al-)\b/gi, '').trim();
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function extractTitleKeywords(title) {
  if (!title) return [];
  return normalize(title)
    .replace(/^(de|in|ad|pro|per|super|contra)\s+/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (author) params.set('author', author);
  params.set('language', 'eng');
  params.set('limit', '5');

  const url = `https://openlibrary.org/search.json?${params}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.docs || []).slice(0, 5).map(doc => ({
      source: 'open_library',
      title: doc.title,
      author: (doc.author_name || []).join('; '),
      year: doc.first_publish_year,
      publisher: (doc.publisher || []).slice(0, 3).join('; '),
      key: doc.key,
      isbn: (doc.isbn || []).slice(0, 2),
      edition_count: doc.edition_count,
      language: (doc.language || []).slice(0, 5),
    }));
  } catch {
    return [];
  }
}

async function searchGoogleBooks(title, author) {
  const q = [title, author].filter(Boolean).join(' ');
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=en&maxResults=5`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).slice(0, 5).map(item => {
      const info = item.volumeInfo || {};
      return {
        source: 'google_books',
        title: info.title,
        subtitle: info.subtitle,
        author: (info.authors || []).join('; '),
        year: info.publishedDate?.match(/\d{4}/)?.[0],
        publisher: info.publisher,
        isbn: (info.industryIdentifiers || []).map(i => i.identifier).slice(0, 2),
        language: info.language,
        google_books_id: item.id,
      };
    });
  } catch {
    return [];
  }
}

async function searchInternetArchive(title, author) {
  const authorSurname = extractSurname(author);
  const titleKw = extractTitleKeywords(title).slice(0, 3).join(' ');

  // IA advanced search — search by creator + language:English
  const query = [
    authorSurname ? `creator:(${authorSurname})` : '',
    titleKw ? `title:(${titleKw})` : '',
    'language:(English)',
  ].filter(Boolean).join(' AND ');

  const params = new URLSearchParams({
    q: query,
    output: 'json',
    rows: '5',
    fl: 'identifier,title,creator,date,publisher,language',
  });

  const url = `https://archive.org/advancedsearch.php?${params}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.response?.docs || []).slice(0, 5).map(doc => ({
      source: 'internet_archive',
      title: doc.title,
      author: Array.isArray(doc.creator) ? doc.creator.join('; ') : (doc.creator || ''),
      year: doc.date?.match(/\d{4}/)?.[0],
      publisher: Array.isArray(doc.publisher) ? doc.publisher.join('; ') : (doc.publisher || ''),
      identifier: doc.identifier,
      language: Array.isArray(doc.language) ? doc.language : [doc.language].filter(Boolean),
    }));
  } catch {
    return [];
  }
}

// ── Format results for LLM ──────────────────────────────────────────

function formatResults(results, source) {
  if (!results || results.length === 0) return 'No results';
  return results.map((r, i) => {
    const parts = [`  ${i + 1}. "${r.title || '?'}"`];
    if (r.subtitle) parts.push(`     Subtitle: ${r.subtitle}`);
    if (r.author) parts.push(`     Author: ${r.author}`);
    if (r.year) parts.push(`     Year: ${r.year}`);
    if (r.publisher) parts.push(`     Publisher: ${r.publisher}`);
    if (r.identifier) parts.push(`     IA ID: ${r.identifier}`);
    if (r.key) parts.push(`     OL key: ${r.key}`);
    if (r.google_books_id) parts.push(`     Google Books ID: ${r.google_books_id}`);
    if (r.edition_count) parts.push(`     Editions: ${r.edition_count}`);
    return parts.join('\n');
  }).join('\n\n');
}

// ── LLM synthesis ───────────────────────────────────────────────────

function buildSynthesisPrompt(book, olResults, gbResults, iaResults) {
  const title = book.display_title || book.title || 'Unknown';
  const author = book.author || 'Unknown';
  const year = book.published || book.year || 'Unknown';
  const language = book.language || book.ai_metadata?.language || 'Unknown';
  const categories = (book.categories || []).join(', ') || 'N/A';

  return `You are a bibliographic researcher analyzing library catalog results to determine if an English translation of a specific work exists.

ORIGINAL WORK:
- Title: "${title}"
- Author: ${author}
- Year: ${year}
- Language: ${language}
- Categories: ${categories}

OPEN LIBRARY RESULTS:
${formatResults(olResults, 'open_library')}

GOOGLE BOOKS RESULTS:
${formatResults(gbResults, 'google_books')}

INTERNET ARCHIVE RESULTS:
${formatResults(iaResults, 'internet_archive')}

Carefully distinguish:
- Actual TRANSLATIONS of this work (count these)
- Different works by the same author (exclude)
- Critical studies ABOUT the work (exclude)
- Works that merely cite this text (exclude)
- Anthology entries containing this text (count as partial)
- Modern editions in the original language (exclude)

Respond JSON only:
{
  "has_english_translation": true/false,
  "translations": [{
    "english_title": "...",
    "translator": "...",
    "pub_year": "...",
    "publisher": "...",
    "completeness": "complete|partial|excerpts|unknown",
    "evidence_source": "open_library|google_books|internet_archive",
    "catalog_id": "...",
    "notes": "why this IS a translation of this specific work"
  }],
  "false_positives_excluded": ["brief description of each excluded result"],
  "evidence_strength": "strong|moderate|weak|none",
  "confidence": "high|medium|low",
  "reasoning": "1-3 sentences",
  "search_limitations": "any caveats about title ambiguity, etc."
}

If no catalog results are translations, say so clearly.
Absence from 3 major catalogs IS evidence supporting first-translation status.
Do NOT hallucinate translations that aren't in the catalog results.`;
}

async function synthesizeWithLLM(book, olResults, gbResults, iaResults) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildSynthesisPrompt(book, olResults, gbResults, iaResults);
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

// ── Cost calculation ────────────────────────────────────────────────

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

// ── Process one book ────────────────────────────────────────────────

async function processBook(book) {
  const title = book.display_title || book.title || '';
  const author = book.author || '';
  const surname = extractSurname(author);
  const titleKw = extractTitleKeywords(title).slice(0, 4).join(' ');

  // Search all three APIs with delays
  const olResults = await searchOpenLibrary(titleKw || title, surname);
  await new Promise(r => setTimeout(r, API_DELAY_MS));

  const gbResults = await searchGoogleBooks(title, author);
  await new Promise(r => setTimeout(r, API_DELAY_MS));

  const iaResults = await searchInternetArchive(title, author);

  const totalResults = olResults.length + gbResults.length + iaResults.length;

  // If all APIs returned nothing, skip LLM — clearly no translation found
  if (totalResults === 0) {
    return {
      has_english_translation: false,
      translations: [],
      false_positives_excluded: [],
      evidence_strength: 'none',
      confidence: 'medium',
      reasoning: 'No results from any of the 3 library catalogs queried.',
      search_limitations: 'Absence of results does not guarantee no translation exists — some may be in specialized databases.',
      usage: { input_tokens: 0, output_tokens: 0 },
      duration_ms: 0,
      skipped_llm: true,
      raw_results: { open_library: olResults, google_books: gbResults, internet_archive: iaResults },
    };
  }

  // Synthesize with LLM
  const llmResult = await synthesizeWithLLM(book, olResults, gbResults, iaResults);

  return {
    ...llmResult,
    raw_results: { open_library: olResults, google_books: gbResults, internet_archive: iaResults },
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 1000;
  const offset = args.includes('--offset') ? parseInt(args[args.indexOf('--offset') + 1]) : 0;
  const bookId = args.includes('--book-id') ? args[args.indexOf('--book-id') + 1] : null;
  const allBooks = args.includes('--all-books');

  console.log(`=== Stage 1: Search Translation Evidence ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL} | Concurrency: ${CONCURRENCY} | Keys: ${apiKeys.length}`);
  console.log(`Limit: ${limit} | Offset: ${offset}`);
  if (bookId) console.log(`Book: ${bookId}`);
  if (allBooks) console.log(`Scope: ALL BOOKS (not just is_first_translation)`);
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find books to process
  let query;
  if (bookId) {
    query = { id: bookId };
  } else if (allBooks) {
    // All non-hidden, non-English books with pages, not yet searched
    query = {
      hidden: { $ne: true },
      pages_count: { $gt: 0 },
      language: { $not: /^english$/i },
      $or: [
        { 'translation_verification.source': { $ne: 'catalog_search' } },
        { 'translation_verification': { $exists: false } },
      ],
    };
  } else {
    query = {
      is_first_translation: true,
      // Skip books already searched via catalog_search
      $or: [
        { 'translation_verification.source': { $ne: 'catalog_search' } },
        { 'translation_verification': { $exists: false } },
      ],
    };
  }

  const books = await db.collection('books')
    .find(query)
    .sort({ read_count: -1, title: 1 })
    .skip(offset)
    .limit(limit)
    .project({
      id: 1, title: 1, display_title: 1, author: 1, language: 1,
      published: 1, year: 1, categories: 1, ai_metadata: 1,
      translation_verification: 1, is_first_translation: 1,
      first_translation_details: 1,
    })
    .toArray();

  console.log(`Found ${books.length} books to search\n`);
  if (books.length === 0) { await client.close(); return; }

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let skippedLlm = 0;
  let errors = 0;
  let totalCost = 0;
  const csvRows = [];

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(batch.map(async (book) => {
      try {
        const result = await processBook(book);
        return { book, result };
      } catch (err) {
        return { book, error: err.message };
      }
    }));

    for (const r of results) {
      processed++;
      if (r.status === 'rejected') {
        errors++;
        console.log(`  [${processed}/${books.length}] FAIL: ${r.reason}`);
        continue;
      }

      const { book, result, error } = r.value;
      const shortTitle = (book.display_title || book.title || '').substring(0, 55);

      if (error || result?.error) {
        errors++;
        console.log(`  [${processed}/${books.length}] ERROR ${shortTitle} -- ${error || result.error}`);
        if (result?.raw) console.log(`      Raw: ${result.raw.substring(0, 150)}`);
        continue;
      }

      const cost = result.usage ? calculateCost(result.usage) : 0;
      totalCost += cost;

      const hasTranslation = result.has_english_translation;
      const translationCount = result.translations?.length || 0;
      const strength = result.evidence_strength || '?';

      if (result.skipped_llm) skippedLlm++;

      if (hasTranslation) {
        found++;
        console.log(`  [${processed}/${books.length}] FOUND      ${shortTitle}`);
        console.log(`      ${translationCount} translation(s) | strength: ${strength} | $${cost.toFixed(4)}`);
        if (result.translations?.[0]) {
          const t = result.translations[0];
          console.log(`      -> "${(t.english_title || '').substring(0, 60)}" (${t.pub_year || '?'}, ${t.completeness || '?'})`);
          if (t.translator) console.log(`         trans. ${t.translator}`);
        }
      } else {
        notFound++;
        const reason = result.skipped_llm ? '(no API results)' : `strength: ${strength}`;
        console.log(`  [${processed}/${books.length}] NONE       ${shortTitle}  ${reason}`);
      }

      if (result.reasoning) {
        console.log(`      ${result.reasoning.substring(0, 120)}`);
      }

      // Build CSV row for each found translation
      if (hasTranslation) {
        for (const t of (result.translations || [])) {
          csvRows.push([
            escapeCsv(book.id),
            escapeCsv(book.display_title || book.title || ''),
            escapeCsv(book.author || ''),
            escapeCsv(book.language || ''),
            escapeCsv(book.published || ''),
            'translation_found',
            escapeCsv(strength),
            escapeCsv(t.english_title || ''),
            escapeCsv(t.translator || ''),
            escapeCsv(t.pub_year || ''),
            escapeCsv(t.completeness || ''),
            escapeCsv(t.evidence_source || ''),
            escapeCsv(t.catalog_id || ''),
            escapeCsv(result.confidence || ''),
          ].join(','));
        }
      } else {
        csvRows.push([
          escapeCsv(book.id),
          escapeCsv(book.display_title || book.title || ''),
          escapeCsv(book.author || ''),
          escapeCsv(book.language || ''),
          escapeCsv(book.published || ''),
          'no_translation',
          escapeCsv(strength),
          '', '', '', '', '', '',
          escapeCsv(result.confidence || ''),
        ].join(','));
      }

      // Store results
      if (!dryRun) {
        const verification = {
          has_english_translation: result.has_english_translation,
          translations: result.translations || [],
          confidence: result.confidence,
          reasoning: result.reasoning,
          model: result.skipped_llm ? null : MODEL,
          verified_at: new Date(),
          source: 'catalog_search',
          search_evidence: {
            searched_at: new Date(),
            apis_queried: ['open_library', 'google_books', 'internet_archive'],
            total_results: (result.raw_results?.open_library?.length || 0) +
                           (result.raw_results?.google_books?.length || 0) +
                           (result.raw_results?.internet_archive?.length || 0),
            evidence_strength: result.evidence_strength,
            false_positives_excluded: result.false_positives_excluded || [],
            search_limitations: result.search_limitations || '',
          },
        };

        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { translation_verification: verification, updated_at: new Date() } }
        );

        // Log LLM call to gemini_usage (only if LLM was actually called)
        if (!result.skipped_llm && result.usage) {
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
            endpoint: 'script/search-translation-evidence',
          });
        }
      }
    }

    if (i + CONCURRENCY < books.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Write CSV
  const csvPath = 'scripts/output/translation-search-results.csv';
  const csvHeader = 'book_id,title,author,language,published,disposition,evidence_strength,english_title,translator,pub_year,completeness,evidence_source,catalog_id,confidence';
  fs.writeFileSync(csvPath, csvHeader + '\n' + csvRows.join('\n') + '\n');
  console.log(`\nWrote ${csvRows.length} rows to ${csvPath}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${processed}`);
  console.log(`Translation found: ${found}`);
  console.log(`No translation: ${notFound}`);
  console.log(`  (skipped LLM - no API results): ${skippedLlm}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total LLM cost: $${totalCost.toFixed(4)}`);

  if (dryRun) console.log('\n(Dry run -- use --apply to write to DB)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
