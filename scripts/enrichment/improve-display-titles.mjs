#!/usr/bin/env node
/**
 * Regenerate display_title for all non-English books using improved prompt.
 *
 * Sends the book title, OCR title page text, and existing metadata to Gemini
 * and asks for a proper English display title. Overwrites existing display_titles
 * that are low quality (shelfmarks, untranslated Latin, etc).
 *
 * Usage:
 *   node scripts/enrichment/improve-display-titles.mjs --dry-run
 *   node scripts/enrichment/improve-display-titles.mjs --apply --limit 20
 *   node scripts/enrichment/improve-display-titles.mjs --apply --book-id BOOK_ID
 *   node scripts/enrichment/improve-display-titles.mjs --apply --offset 100 --limit 50
 *   node scripts/enrichment/improve-display-titles.mjs --apply --skip-good
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import https from 'https';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-3-flash-preview';
const CONCURRENCY = 5;

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

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
const SKIP_GOOD = args.includes('--skip-good');

function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const OFFSET = getArg('--offset') ? parseInt(getArg('--offset')) : 0;
const BOOK_ID = getArg('--book-id');

if (!DRY_RUN && !APPLY) {
  console.error('Specify --dry-run or --apply');
  process.exit(1);
}

// ── Quality heuristics ──────────────────────────────────────────────
// Detect display_titles that are likely low quality and need regeneration
function isLikelyBadTitle(displayTitle, originalTitle, language) {
  if (!displayTitle) return true;
  const dt = displayTitle.trim();
  if (!dt) return true;

  // Manuscript shelfmarks
  if (/\bMS[\.\s]/i.test(dt)) return true;
  if (/\bBodl[\.\s]/i.test(dt)) return true;
  if (/\bHarley\b/i.test(dt)) return true;
  if (/\bReg\.lat\./i.test(dt)) return true;
  if (/\bPal\.lat\./i.test(dt)) return true;
  if (/\bCod\.\s/i.test(dt)) return true;

  // Library names as titles
  if (/^(Bodleian|Vatican|British)\s+Library/i.test(dt)) return true;

  // Contains parenthetical original-language text
  if (/\([A-Z][a-z].*[a-z]\)$/.test(dt)) {
    // Check if the parenthetical looks like a foreign title
    const paren = dt.match(/\(([^)]+)\)$/)?.[1] || '';
    if (paren.length > 10) return true;
  }

  // Contains edition metadata in parens
  if (/\(\d{4}\s+\w+\)/.test(dt)) return true;
  if (/\(\d{4}[-–]\d{4}\)/.test(dt)) return true;

  // Exact match to original title (no translation happened)
  if (dt === originalTitle) return true;

  // Very common untranslated Latin words that should be translated
  const latinWords = [
    'de ', 'liber ', 'opus ', 'commentar', 'tractatus ', 'epistol',
    'adversus ', 'apologi', 'disputat', 'praefatio', 'philosophorum',
    'medicorum', 'contemplation',
  ];
  const dtLower = dt.toLowerCase();
  // If more than half the title is Latin-looking words, it's probably untranslated
  const latinHits = latinWords.filter(w => dtLower.includes(w)).length;
  if (latinHits >= 3) return true;

  // Title starts with "De " (Latin, unless it's a known proper name)
  if (/^De [A-Z]/.test(dt) && language !== 'English') {
    // "De Rerum Natura" is OK but most "De X" titles should be translated
    const knownLatinKeepers = ['De Rerum Natura'];
    if (!knownLatinKeepers.includes(dt)) return true;
  }

  // Single untranslated word like "Opera"
  if (/^[A-Z][a-z]+$/.test(dt) && dt.length < 15) {
    const englishWords = ['Mysticism', 'Alchemy', 'Astronomy', 'Philosophy', 'Medicine'];
    if (!englishWords.includes(dt)) return true;
  }

  return false;
}

// ── Prompt ──────────────────────────────────────────────────────────
function buildPrompt(book, ocrText) {
  return `You are a rare books librarian creating an English display title for a historical book catalog.

BOOK:
- Original title: "${book.title}"
- Author: ${book.author || 'Unknown'}
- Published: ${book.published || 'unknown'}
- Language: ${book.language || 'unknown'}
- Categories: ${(book.categories || []).join(', ') || 'none'}
- Current display_title: ${book.display_title ? `"${book.display_title}"` : 'none'}
- Description: ${book.description || 'none'}

TITLE PAGE OCR:
${ocrText || '[No OCR available]'}

Generate a clear, natural English title for this book. Respond with JSON only:

{
  "display_title": "<English title>",
  "reasoning": "<1 sentence explaining your choice>"
}

RULES — you MUST follow all of these:
1. The title must be ENTIRELY in English. No Latin, German, French, Arabic, Sanskrit, Hebrew, Greek, or any other non-English words.
2. Use the conventional English name if one is well-established:
   - "The Chemical Wedding" not "Chymische Hochzeit"
   - "Discourse on the Method" not "Discours de la méthode"
   - "On the Revolution of Celestial Spheres" not "De Revolutionibus"
   - "The Emerald Tablet" not "Tabula Smaragdina"
3. If no conventional English name exists, translate the title literally:
   - "De Triplici Minimo et Mensura" → "On the Threefold Minimum and Measure"
   - "Conciliator Differentiarum Philosophorum" → "Reconciler of the Differences Among Philosophers"
   - "Ortus Medicinae" → "The Origin of Medicine"
4. Do NOT include manuscript shelfmarks or catalog identifiers (no "MS. Bodl. 130", "Reg.lat.1278")
5. Do NOT include library names (no "Bodleian Library...", "Vatican Library...")
6. Do NOT include edition dates, publishers, or printing info (no "1645 Elzevier", "Basel edition")
7. Do NOT include the original title in parentheses (no "Origin of Medicine (Ortus Medicinae)")
8. For transliterated titles (Sanskrit, Arabic, Hebrew), translate the MEANING:
   - "Yuddha Jayarnava" → "Ocean of Victory in Battle"
   - "Bhasha Svarodaya" → "Discourse on the Rising of Sounds"
   - "Ganakaranjani" → "Delight of Mathematicians"
9. Keep it concise — translate the essential title, not the full baroque subtitle
10. If the book is a collection/compilation with no single title, describe it: "Collected Works on Alchemy" etc.
11. "Opera" alone is not a title — use "Collected Works" or "Complete Works of [Author]"
12. Return null if the book is already in English`;
}

// ── Gemini call ─────────────────────────────────────────────────────
function httpsPost(url, body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Gemini ${res.statusCode}: ${data.substring(0, 200)}`));
        } else {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 200)}`)); }
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`Request timeout after ${timeoutMs/1000}s`)); });
    req.write(postData);
    req.end();
  });
}

async function generateTitle(book, ocrText) {
  const apiKey = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  const prompt = buildPrompt(book, ocrText);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const data = await httpsPost(url, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }, 90000);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Gemini');

  const parsed = JSON.parse(text);
  if (!parsed.display_title && parsed.display_title !== null) {
    throw new Error('No display_title in response');
  }

  const usage = data.usageMetadata || {};
  return {
    display_title: parsed.display_title,
    reasoning: parsed.reasoning || '',
    tokens: {
      input: usage.promptTokenCount || 0,
      output: usage.candidatesTokenCount || 0,
    },
  };
}

// ── Process with concurrency ────────────────────────────────────────
async function processInBatches(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    process.stderr.write(`\n── Batch ${Math.floor(i/concurrency)+1}/${Math.ceil(items.length/concurrency)} (items ${i+1}-${Math.min(i+concurrency, items.length)}) ──\n`);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5,
  });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Build query: all non-English books (including ones with existing display_titles)
  const query = {
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
  };

  if (BOOK_ID) {
    delete query.hidden;
    delete query.pages_count;
    query.id = BOOK_ID;
  } else {
    // Non-English books only
    query.language = { $nin: ['English', 'english', null, ''] };
  }

  const totalCount = await db.collection('books').countDocuments(query);
  console.log(`Found ${totalCount} non-English books`);

  const cursor = db.collection('books')
    .find(query, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, categories: 1, description: 1,
      }
    })
    .sort({ read_count: -1, created_at: 1 })
    .skip(OFFSET);

  if (LIMIT) cursor.limit(LIMIT);

  let books = await cursor.toArray();
  console.log(`Loaded ${books.length} books (offset=${OFFSET}${LIMIT ? ', limit=' + LIMIT : ''})`);

  // If --skip-good, filter to only books with bad titles
  if (SKIP_GOOD) {
    const before = books.length;
    books = books.filter(b => isLikelyBadTitle(b.display_title, b.title, b.language));
    console.log(`Filtered to ${books.length} books with likely-bad titles (skipped ${before - books.length} good ones)`);
  }

  let processed = 0;
  let improved = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  await processInBatches(books, async (book) => {
    const bookId = book.id || book._id?.toString();
    const title = book.title;
    const oldDisplay = book.display_title || '(none)';
    processed++;

    try {
      // Fetch title page OCR
      const [titlePages, earlyPages] = await Promise.all([
        db.collection('pages')
          .find(
            { book_id: bookId, page_type: 'title_page', 'ocr.data': { $exists: true, $ne: '' } },
            { projection: { page_number: 1, 'ocr.data': 1, page_type: 1 } }
          )
          .sort({ page_number: 1 })
          .limit(2)
          .toArray(),
        db.collection('pages')
          .find(
            { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
            { projection: { page_number: 1, 'ocr.data': 1, page_type: 1 } }
          )
          .sort({ page_number: 1 })
          .limit(5)
          .toArray(),
      ]);

      // Deduplicate: title pages first, then early pages
      const seenPages = new Set();
      const contextPages = [];
      for (const p of titlePages) {
        seenPages.add(p.page_number);
        contextPages.push(p);
      }
      for (const p of earlyPages) {
        if (seenPages.has(p.page_number)) continue;
        const text = p.ocr?.data || '';
        if (text.length < 50) continue;
        if (/^\s*\[?\s*blank\s*page\s*\]?\s*$/i.test(text)) continue;
        seenPages.add(p.page_number);
        contextPages.push(p);
        if (contextPages.length >= 4) break;
      }

      const ocrText = contextPages
        .map(p => `--- Page ${p.page_number}${p.page_type ? ` (${p.page_type})` : ''} ---\n${(p.ocr?.data || '').slice(0, 1500)}`)
        .join('\n\n')
        .slice(0, 5000);

      const result = await generateTitle(book, ocrText);
      totalTokensIn += result.tokens.input;
      totalTokensOut += result.tokens.output;

      // Skip if null (English book)
      if (result.display_title === null) {
        skipped++;
        process.stderr.write(`  [${processed}/${books.length}] ${title.substring(0, 50)} — skipped (English)\n`);
        return;
      }

      const newTitle = result.display_title.trim();

      // Skip if same as existing
      if (newTitle === book.display_title) {
        unchanged++;
        process.stderr.write(`  [${processed}/${books.length}] ${title.substring(0, 50)} — unchanged\n`);
        return;
      }

      improved++;
      console.log(`  [${processed}/${books.length}] "${oldDisplay}" → "${newTitle}" (${result.reasoning})`);

      if (APPLY) {
        await db.collection('books').updateOne(
          { id: bookId },
          {
            $set: {
              display_title: newTitle,
              'field_provenance.display_title': {
                source: 'ai_enrichment',
                model: MODEL,
                date: new Date(),
                note: `Regenerated display_title. Previous: "${book.display_title || ''}"`,
              },
              updated_at: new Date(),
            },
          }
        );
      }
    } catch (err) {
      errors++;
      console.error(`  [${processed}/${books.length}] ${title.substring(0, 50)} — ERROR: ${err.message}`);
    }
  }, CONCURRENCY);

  // Summary
  const costIn = (totalTokensIn / 1_000_000) * 0.15;
  const costOut = (totalTokensOut / 1_000_000) * 0.60;
  const totalCost = costIn + costOut;

  console.log('\n── Summary ──');
  console.log(`Processed: ${processed}`);
  console.log(`Improved: ${improved}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Skipped (English): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Tokens: ${totalTokensIn.toLocaleString()} in / ${totalTokensOut.toLocaleString()} out`);
  console.log(`Est. cost: $${totalCost.toFixed(3)}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLIED'}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
