#!/usr/bin/env node
/**
 * FT grounded remediation (issue #1974).
 *
 * The is_first_translation flag is unreliable because two upstream passes set it
 * and one of them (content-based ai_enrichment) cannot establish whether someone
 * else already published a translation. A spot-check of the memory-based strict
 * re-verifier (ft-reverify-strict.mjs) found ~12-29% of its NOT_FIRST verdicts
 * are wrong — all in the subset where the verdict rested on the model's memory
 * rather than a recorded catalog hit. See:
 *   docs/translation-gap-census-paper/ft-reverify-findings.md
 *
 * METHODOLOGICAL RULE: a NOT_FIRST determination is a *presence* claim — a prior
 * translation is a positive bibliographic fact that lives in CATALOGS, not in
 * model memory. So this script does NOT ask the model what it remembers. It
 * searches three live catalogs (Open Library, Google Books, Internet Archive)
 * for each work and only lets the model SYNTHESIZE those results (with an
 * explicit "do not hallucinate translations not in the results" instruction).
 * The catalog search + synthesis logic is the same proven path used by
 * scripts/enrichment/search-translation-evidence.mjs (Stage 1).
 *
 * NON-DESTRUCTIVE: writes proposals to the `ft_reverify_proposal` collection.
 * It NEVER writes is_first_translation and NEVER overwrites translation_verification.
 * Flag changes are a separate, human-reviewed step downstream.
 *
 * Buckets per book (grounded):
 *   NOT_FIRST     — catalog returned a genuine prior English translation
 *                   (proposed_flag:false; safe to confirm after review)
 *   FIRST_LIKELY  — it IS a translation and no catalog has a prior English one
 *                   (NOT an auto-true: absence-of-evidence; needs human sign-off)
 *   NEEDS_HUMAN   — ambiguous / synthesis error
 *
 * Usage:
 *   node scripts/analysis/ft-ground-remediation.mjs --set contested [--limit N] [--refresh]
 *   node scripts/analysis/ft-ground-remediation.mjs --set unverified --limit 200
 * Resumable: books already in ft_reverify_proposal are skipped unless --refresh.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

const MODEL = 'gemini-3.1-flash-lite';
const CONCURRENCY = 3;
const API_DELAY_MS = 400;
const BATCH_DELAY_MS = 300;
const FIRST_DISPOSITIONS = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'];

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
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
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
  for (let i = 2; i <= 10; i++) if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  if (env.GEMINI_API_KEY_TIER3) keys.push(env.GEMINI_API_KEY_TIER3);
  return keys;
}
const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY found'); process.exit(1); }
let keyIndex = 0;
function getClient() { const k = apiKeys[keyIndex % apiKeys.length]; keyIndex++; return new GoogleGenerativeAI(k); }

// ── Catalog search helpers (copied verbatim from search-translation-evidence.mjs) ──
function normalize(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
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
  return normalize(title).replace(/^(de|in|ad|pro|per|super|contra)\s+/g, '').split(/\s+/).filter(w => w.length > 2);
}
function cleanTitleForSearch(title) {
  if (!title) return '';
  return title
    .replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(vol(ume)?|tom(us|e)|tomus|book|part|pt|bk)\.?\s*[ivxlcdm\d]+\b/gi, ' ')
    .replace(/[:;.,/]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams();
  const cleanTitle = cleanTitleForSearch(title);
  if (cleanTitle) params.set('title', cleanTitle);
  if (author) params.set('author', author);
  params.set('language', 'eng');
  params.set('limit', '5');
  try {
    const resp = await fetch(`https://openlibrary.org/search.json?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) { if (resp.status === 429) console.warn('  [OL] rate-limited'); return []; }
    const data = await resp.json();
    return (data.docs || []).slice(0, 5).map(doc => ({
      source: 'open_library', title: doc.title, author: (doc.author_name || []).join('; '),
      year: doc.first_publish_year, publisher: (doc.publisher || []).slice(0, 3).join('; '),
      key: doc.key, edition_count: doc.edition_count, language: (doc.language || []).slice(0, 5),
    }));
  } catch { return []; }
}

let gbExhausted = false;
async function searchGoogleBooks(title, author) {
  if (gbExhausted) return [];
  const q = [cleanTitleForSearch(title), author].filter(Boolean).join(' ');
  const apiKey = env.GOOGLE_BOOKS_API_KEY || env.GOOGLE_API_KEY || '';
  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=en&maxResults=5${keyParam}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      if (resp.status === 429) { console.warn('  [GB] daily quota hit — OL+IA continue to ground'); gbExhausted = true; }
      else if (resp.status === 403) console.warn('  [GB] forbidden (403)');
      return [];
    }
    const data = await resp.json();
    return (data.items || []).slice(0, 5).map(item => {
      const info = item.volumeInfo || {};
      return {
        source: 'google_books', title: info.title, subtitle: info.subtitle,
        author: (info.authors || []).join('; '), year: info.publishedDate?.match(/\d{4}/)?.[0],
        publisher: info.publisher, language: info.language, google_books_id: item.id,
      };
    });
  } catch { return []; }
}

async function searchInternetArchive(title, author) {
  const authorSurname = extractSurname(author);
  const titleKw = extractTitleKeywords(title).slice(0, 3).join(' ');
  const query = [authorSurname ? `creator:(${authorSurname})` : '', titleKw ? `title:(${titleKw})` : ''].filter(Boolean).join(' AND ');
  const params = new URLSearchParams({ q: query, output: 'json', rows: '5', fl: 'identifier,title,creator,date,publisher,language' });
  try {
    const resp = await fetch(`https://archive.org/advancedsearch.php?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) { if (resp.status === 429) console.warn('  [IA] rate-limited'); return []; }
    const data = await resp.json();
    return (data.response?.docs || []).slice(0, 5).map(doc => ({
      source: 'internet_archive', title: doc.title,
      author: Array.isArray(doc.creator) ? doc.creator.join('; ') : (doc.creator || ''),
      year: doc.date?.match(/\d{4}/)?.[0],
      publisher: Array.isArray(doc.publisher) ? doc.publisher.join('; ') : (doc.publisher || ''),
      identifier: doc.identifier, language: Array.isArray(doc.language) ? doc.language : [doc.language].filter(Boolean),
    }));
  } catch { return []; }
}

function formatResults(results) {
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

function buildSynthesisPrompt(book, ol, gb, ia) {
  const title = book.display_title || book.title || 'Unknown';
  return `You are a bibliographic researcher analyzing library catalog results to determine if an English translation of a specific work exists.

ORIGINAL WORK:
- Title: "${title}"
- Author: ${book.author || 'Unknown'}
- Year: ${book.published || book.year || 'Unknown'}
- Language: ${book.language || 'Unknown'}
- Categories: ${(book.categories || []).join(', ') || 'N/A'}

OPEN LIBRARY RESULTS:
${formatResults(ol)}

GOOGLE BOOKS RESULTS:
${formatResults(gb)}

INTERNET ARCHIVE RESULTS:
${formatResults(ia)}

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
    "english_title": "...", "translator": "...", "pub_year": "...", "publisher": "...",
    "completeness": "complete|partial|excerpts|unknown",
    "evidence_source": "open_library|google_books|internet_archive",
    "catalog_id": "...", "notes": "why this IS a translation of this specific work"
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

async function synthesize(book, ol, gb, ia) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL, generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' } });
  const result = await model.generateContent(buildSynthesisPrompt(book, ol, gb, ia));
  const resp = result.response;
  const text = (resp.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim() || resp.text().trim();
  try { return JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return { error: 'parse_failed' }; }
}

async function groundBook(book) {
  const title = book.display_title || book.title || '';
  const author = book.author || '';
  const surname = extractSurname(author);
  const titleKw = extractTitleKeywords(title).slice(0, 4).join(' ');
  const ol = await searchOpenLibrary(titleKw || title, surname);
  await new Promise(r => setTimeout(r, API_DELAY_MS));
  const gb = await searchGoogleBooks(title, author);
  await new Promise(r => setTimeout(r, API_DELAY_MS));
  const ia = await searchInternetArchive(title, author);
  const total = ol.length + gb.length + ia.length;
  const raw = { open_library: ol, google_books: gb, internet_archive: ia };
  if (total === 0) {
    return { has_english_translation: false, translations: [], evidence_strength: 'none', confidence: 'medium',
      reasoning: 'No results from any of the 3 library catalogs queried.', skipped_llm: true, raw };
  }
  const llm = await synthesize(book, ol, gb, ia);
  return { ...llm, raw };
}

// Bucket grounded evidence into a proposal verdict. Mirrors the methodological
// rule: a prior translation must be CATALOG-grounded; absence never auto-sets true.
function bucket(result) {
  if (result.error) return { verdict: 'NEEDS_HUMAN', proposed_flag: null, why: 'synthesis_error' };
  if (result.has_english_translation && (result.translations || []).length > 0) {
    return { verdict: 'NOT_FIRST', proposed_flag: false, why: 'catalog_found_prior_translation' };
  }
  // No catalog translation found → candidate first, but absence-of-evidence:
  // never auto-true. Human reviews FIRST_LIKELY before any flag is written.
  return { verdict: 'FIRST_LIKELY', proposed_flag: null, why: 'no_catalog_translation_found' };
}

async function main() {
  const args = process.argv.slice(2);
  const set = args.includes('--set') ? args[args.indexOf('--set') + 1] : 'contested';
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100000;
  const refresh = args.includes('--refresh');

  let query;
  if (set === 'contested') {
    query = { language: 'Latin', pages_translated: { $gt: 0 }, is_first_translation: false, 'translation_verification.disposition': { $in: FIRST_DISPOSITIONS } };
  } else if (set === 'unverified') {
    query = { language: 'Latin', pages_translated: { $gt: 0 }, 'translation_verification': { $exists: false } };
  } else { console.error(`unknown --set ${set} (use: contested | unverified)`); process.exit(1); }

  console.log(`=== FT grounded remediation ===`);
  console.log(`Set: ${set} | limit: ${limit} | refresh: ${refresh}`);
  console.log(`Model: ${MODEL} | keys: ${apiKeys.length} | concurrency: ${CONCURRENCY}`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);
  const proposals = db.collection('ft_reverify_proposal');
  await proposals.createIndex({ book_id: 1 }, { unique: true }).catch(() => {});

  let books = await db.collection('books').find(query)
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, categories: 1, is_first_translation: 1, 'translation_verification.disposition': 1 })
    .toArray();

  if (!refresh) {
    const done = new Set((await proposals.find({}, { projection: { book_id: 1 } }).toArray()).map(p => p.book_id));
    const before = books.length;
    books = books.filter(b => !done.has(b.id));
    console.log(`Resuming: ${before} in set, ${before - books.length} already proposed, ${books.length} remaining`);
  }
  books = books.slice(0, limit);
  console.log(`Grounding ${books.length} books\n`);
  if (books.length === 0) { await client.close(); return; }

  const tally = { NOT_FIRST: 0, FIRST_LIKELY: 0, NEEDS_HUMAN: 0 };
  let processed = 0, errors = 0;

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(async book => ({ book, result: await groundBook(book) })));
    for (const s of settled) {
      processed++;
      if (s.status === 'rejected') { errors++; console.log(`  [${processed}/${books.length}] FAIL ${s.reason}`); continue; }
      const { book, result } = s.value;
      const b = bucket(result);
      tally[b.verdict]++;
      const short = (book.display_title || book.title || '').substring(0, 50);
      const t0 = (result.translations || [])[0];
      const ev = t0 ? ` -> "${(t0.english_title || '').substring(0, 45)}" (${t0.pub_year || '?'}, ${t0.translator || '?'})` : '';
      console.log(`  [${processed}/${books.length}] ${b.verdict.padEnd(12)} ${short}${ev}`);
      await proposals.updateOne(
        { book_id: book.id },
        { $set: {
            book_id: book.id, title: book.display_title || book.title, author: book.author || '', language: book.language,
            old_flag: book.is_first_translation ?? null, old_disposition: book.translation_verification?.disposition ?? null,
            verdict: b.verdict, proposed_flag: b.proposed_flag, reason_code: b.why,
            grounded: true, source: 'catalog_search',
            has_english_translation: result.has_english_translation ?? null,
            translations: result.translations || [], evidence_strength: result.evidence_strength || null,
            confidence: result.confidence || null, reasoning: result.reasoning || null,
            catalog_counts: { open_library: result.raw?.open_library?.length || 0, google_books: result.raw?.google_books?.length || 0, internet_archive: result.raw?.internet_archive?.length || 0 },
            set, created_at: new Date(),
        } },
        { upsert: true },
      );
    }
    if (i + CONCURRENCY < books.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\n=== done: ${processed} grounded, ${errors} errors ===`);
  console.log('verdicts:', JSON.stringify(tally));
  console.log('NOTE: proposals only. No is_first_translation flag written. NOT_FIRST(catalog-grounded) is safe to confirm false after review; FIRST_LIKELY needs human sign-off before any true.');
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
