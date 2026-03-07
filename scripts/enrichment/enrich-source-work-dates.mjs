#!/usr/bin/env node
/**
 * Enrich books with source work compositional timeline.
 *
 * For each book, determines when the original text was composed, whether
 * this is a translation/adaptation of an older work, and stores the
 * chronological layers in `book.source_work_dates`.
 *
 * Usage:
 *   node scripts/enrichment/enrich-source-work-dates.mjs --dry-run
 *   node scripts/enrichment/enrich-source-work-dates.mjs --apply --limit 20
 *   node scripts/enrichment/enrich-source-work-dates.mjs --apply --skip-existing
 *   node scripts/enrichment/enrich-source-work-dates.mjs --apply --book-id BOOK_ID
 *   node scripts/enrichment/enrich-source-work-dates.mjs --apply --offset 100 --limit 50
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

// API key rotation handled in enrichBook()

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
const SKIP_EXISTING = args.includes('--skip-existing');

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

// ── Prompt ──────────────────────────────────────────────────────────
function buildPrompt(book, ocrText) {
  return `You are a historian of ideas analyzing a historical book to determine the compositional timeline of its source material.

BOOK:
- Title: "${book.title}"
- Author: ${book.author}
- Published: ${book.published || 'unknown'}
- Language: ${book.language || 'unknown'}
- Categories: ${(book.categories || []).join(', ') || 'none'}

TITLE PAGE / EARLY OCR:
${ocrText || '[No OCR available]'}

Determine the chronological layers of this work. Most books have 1-2 layers:

1. COMPOSITION: When was the original text written? By whom? In what language?
   - For classical works, use scholarly consensus dates
   - For medieval/early modern originals, the author's floruit or known composition date
   - If this IS the original composition (not a translation), skip this — the published date IS the composition date

2. TRANSLATION/EDITION: If this is a translation or adaptation of an older work, when was THIS version created? By whom?
   - Only include if the translator/editor is different from the original author
   - A 1550 printing of a 1484 Ficino translation = two layers

Do NOT include the printing/publication date as a layer — that's already stored separately.
If this book IS the original work by its author (e.g., Agrippa writing De Occulta Philosophia), return an empty array — the published date already captures it.

Respond JSON only:
{
  "layers": [
    {
      "type": "composition|translation|compilation|commentary|redaction|edition|abridgement",
      "date": "<year as string, negative for BCE, e.g. '-360', '300', '1484'>",
      "date_display": "<human readable, e.g. 'c. 360 BCE', '1484', '13th century'>",
      "date_precision": "exact|decade|century|millennium",
      "author": "<person responsible for this layer>",
      "work_title": "<title of the work at this layer, if different>",
      "language": "<language of the text at this layer>",
      "notes": "<brief note on dating basis>"
    }
  ],
  "confidence": "high|medium|low",
  "reasoning": "<1-2 sentences about the compositional history>"
}

Rules:
- Return empty layers [] if the book is an original work by its stated author
- For pseudepigraphical works (attributed to Hermes, Solomon, etc.), give the scholarly consensus date, not the attributed date
- Use "c." prefix in date_display for approximate dates
- Negative years for BCE (date: "-360", date_display: "c. 360 BCE")
- If the title page names a translator (e.g., "Marsilio Ficino interprete"), include that as a translation layer`;
}

// ── Gemini call (node:https with socket timeout) ────────────────────
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

async function enrichBook(book, ocrText) {
  const apiKey = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  const prompt = buildPrompt(book, ocrText);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const data = await httpsPost(url, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
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

  // Validate structure
  if (!Array.isArray(parsed.layers)) {
    throw new Error('Invalid response: missing layers array');
  }

  for (const layer of parsed.layers) {
    if (!layer.type || !layer.date || !layer.date_display || !layer.date_precision) {
      throw new Error(`Invalid layer: missing required fields: ${JSON.stringify(layer)}`);
    }
    const validTypes = ['composition', 'translation', 'compilation', 'commentary', 'redaction', 'edition', 'abridgement', 'adaptation'];
    if (layer.type.includes('|')) {
      layer.type = layer.type.split('|')[0].trim();
    }
    if (!validTypes.includes(layer.type)) {
      throw new Error(`Invalid layer type: ${layer.type}`);
    }
    const validPrecisions = ['exact', 'decade', 'century', 'millennium'];
    if (!validPrecisions.includes(layer.date_precision)) {
      throw new Error(`Invalid precision: ${layer.date_precision}`);
    }
  }

  const usage = data.usageMetadata || {};
  return {
    layers: parsed.layers,
    confidence: parsed.confidence || 'medium',
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

  // Build query
  const query = {};
  if (BOOK_ID) {
    query.id = BOOK_ID;
  }
  if (SKIP_EXISTING) {
    query.source_work_dates = { $exists: false };
  }
  // Exclude hidden/empty books
  if (!BOOK_ID) {
    query.hidden = { $ne: true };
    query.pages_count = { $gt: 0 };
  }

  const totalCount = await db.collection('books').countDocuments(query);
  console.log(`Found ${totalCount} books matching query`);

  const cursor = db.collection('books')
    .find(query, {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, categories: 1, source_work_dates: 1,
      }
    })
    .sort({ read_count: -1, created_at: 1 })
    .skip(OFFSET);

  if (LIMIT) cursor.limit(LIMIT);

  const books = await cursor.toArray();
  console.log(`Processing ${books.length} books (offset=${OFFSET}${LIMIT ? ', limit=' + LIMIT : ''})`);

  let processed = 0;
  let enriched = 0;
  let originals = 0;
  let errors = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const results = await processInBatches(books, async (book) => {
    const bookId = book.id || book._id?.toString();
    const title = book.display_title || book.title;
    processed++;
    process.stderr.write(`  → [${processed}/${books.length}] Starting: ${title.substring(0, 60)}...\n`);

    try {
      // Fetch title page + early pages for context.
      const pageQueryStart = Date.now();
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
          .limit(15)
          .toArray(),
      ]);
      process.stderr.write(`    DB query: ${Date.now() - pageQueryStart}ms\n`);

      // Deduplicate and prioritize: title pages first, then early pages with
      // substantial text (skip near-blank pages like "[Blank Page]")
      const seenPages = new Set();
      const contextPages = [];

      // Add title pages first
      for (const p of titlePages) {
        seenPages.add(p.page_number);
        contextPages.push(p);
      }

      // Add early pages with real content (>100 chars, not blank-page markers)
      for (const p of earlyPages) {
        if (seenPages.has(p.page_number)) continue;
        const text = p.ocr?.data || '';
        if (text.length < 100) continue;
        if (/^\s*\[?\s*blank\s*page\s*\]?\s*$/i.test(text)) continue;
        seenPages.add(p.page_number);
        contextPages.push(p);
        if (contextPages.length >= 5) break;
      }

      const ocrText = contextPages
        .map(p => `--- Page ${p.page_number}${p.page_type ? ` (${p.page_type})` : ''} ---\n${(p.ocr?.data || '').slice(0, 1500)}`)
        .join('\n\n')
        .slice(0, 6000); // cap total context

      const geminiStart = Date.now();
      const result = await enrichBook(book, ocrText);
      process.stderr.write(`    Gemini: ${Date.now() - geminiStart}ms\n`);
      totalTokensIn += result.tokens.input;
      totalTokensOut += result.tokens.output;

      if (result.layers.length === 0) {
        originals++;
        console.log(`  [${processed}/${books.length}] ${title} — original work (no upstream layers)`);

        if (APPLY) {
          await db.collection('books').updateOne(
            { id: bookId },
            {
              $set: {
                source_work_dates: [],
                source_work_dates_meta: {
                  enriched_at: new Date(),
                  model: MODEL,
                  confidence: result.confidence,
                  source: 'ai_enrichment',
                  reasoning: result.reasoning,
                },
              },
            }
          );
        }
        return { bookId, title, layers: [], confidence: result.confidence };
      }

      enriched++;
      const layerSummary = result.layers
        .map(l => `${l.type}: ${l.author || '?'} ${l.date_display}`)
        .join(' → ');
      console.log(`  [${processed}/${books.length}] ${title} — ${layerSummary}`);

      if (APPLY) {
        await db.collection('books').updateOne(
          { id: bookId },
          {
            $set: {
              source_work_dates: result.layers,
              source_work_dates_meta: {
                enriched_at: new Date(),
                model: MODEL,
                confidence: result.confidence,
                source: 'ai_enrichment',
                reasoning: result.reasoning,
              },
            },
          }
        );
      }

      return { bookId, title, layers: result.layers, confidence: result.confidence };
    } catch (err) {
      errors++;
      console.error(`  [${processed}/${books.length}] ${title} — ERROR: ${err.message}`);
      return { bookId, title, error: err.message };
    }
  }, CONCURRENCY);

  // Summary
  const costIn = (totalTokensIn / 1_000_000) * 0.15;   // Gemini 2.5 Flash input
  const costOut = (totalTokensOut / 1_000_000) * 0.60;  // Gemini 2.5 Flash output
  const totalCost = costIn + costOut;

  console.log('\n── Summary ──');
  console.log(`Processed: ${processed}`);
  console.log(`Enriched (has layers): ${enriched}`);
  console.log(`Original works (empty layers): ${originals}`);
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
