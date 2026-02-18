#!/usr/bin/env node
/**
 * Parse numeric `year` from `published` string for all books missing it.
 * Uses regex patterns first (covers ~95%), then Gemini for ambiguous cases.
 *
 * Usage:
 *   secret-lover run -- node scripts/backfill-year-from-published.mjs --dry-run
 *   secret-lover run -- node scripts/backfill-year-from-published.mjs --apply
 */
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BATCH_SIZE = 50; // books per Gemini call
const GEMINI_CONCURRENCY = 3;

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
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const apiKeys = [];
if (env.GEMINI_API_KEY) apiKeys.push(env.GEMINI_API_KEY);
for (let i = 2; i <= 10; i++) {
  if (env[`GEMINI_API_KEY_${i}`]) apiKeys.push(env[`GEMINI_API_KEY_${i}`]);
}
let keyIndex = 0;
function getClient() {
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}

// ── Year parsing ────────────────────────────────────────────────────

function parseYearFromPublished(published) {
  if (!published || typeof published !== 'string') return null;
  const s = published.trim();

  // Direct 4-digit year: "1617", "1617.", " 1617 "
  const directYear = s.match(/^(\d{4})\.?$/);
  if (directYear) return parseInt(directYear[1]);

  // "c. 1550", "ca. 1550", "circa 1550", "c.1550"
  const circa = s.match(/(?:c\.?\s*|ca\.?\s*|circa\s+)(\d{4})/i);
  if (circa) return parseInt(circa[1]);

  // Range: "1473-1480", "1473–1480" → take first year
  const range = s.match(/(\d{4})\s*[-–]\s*\d{4}/);
  if (range) return parseInt(range[1]);

  // "1617?" or "[1617]" or "(1617)"
  const bracketed = s.match(/[\[(\s]?(\d{4})[\])\s?]?/);
  if (bracketed) return parseInt(bracketed[1]);

  // Year somewhere in the string: "London, 1617" or "Printed in 1617"
  const embedded = s.match(/\b(\d{4})\b/);
  if (embedded) {
    const y = parseInt(embedded[1]);
    if (y >= 800 && y <= 2100) return y;
  }

  // Century strings: "15th century" → 1450 (midpoint), "16th century" → 1550
  const century = s.match(/(\d{1,2})(?:th|st|nd|rd)\s+century/i);
  if (century) return (parseInt(century[1]) - 1) * 100 + 50;

  return null;
}

// ── Gemini for ambiguous ────────────────────────────────────────────

async function inferYearsWithGemini(books) {
  if (apiKeys.length === 0) return {};

  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, safetySettings: SAFETY_SETTINGS });

  const items = books.map(b => ({
    id: b._id.toString(),
    title: b.title || b.display_title || '',
    author: b.author || '',
    published: b.published || '',
  }));

  const prompt = `You are a rare books librarian. For each book below, determine the most likely publication year as a single integer.

If the published field contains a date, parse it. If it's ambiguous, use the title and author to estimate.
If truly unknown, respond with null.

Respond with JSON only — no markdown fences. Format: { "results": [ { "id": "...", "year": 1617 }, ... ] }

Books:
${JSON.stringify(items, null, 2)}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const clean = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(clean);
    const map = {};
    for (const r of parsed.results || []) {
      if (r.year && typeof r.year === 'number' && r.year >= 800 && r.year <= 2100) {
        map[r.id] = r.year;
      }
    }
    return map;
  } catch (e) {
    console.error(`  Gemini error: ${e.message}`);
    return {};
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function run() {
  const dryRun = !process.argv.includes('--apply');
  if (dryRun) console.log('DRY RUN — pass --apply to write changes\n');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Find books with published but no numeric year
  const candidates = await books.find({
    $or: [{ year: { $exists: false } }, { year: null }],
    published: { $exists: true, $ne: '' }
  }).project({ _id: 1, title: 1, display_title: 1, author: 1, published: 1 }).toArray();

  console.log(`Found ${candidates.length} books with published but no year\n`);

  let regexParsed = 0;
  let geminiParsed = 0;
  let failed = 0;
  const needsGemini = [];
  const updates = [];

  // Phase 1: regex parsing
  for (const book of candidates) {
    const year = parseYearFromPublished(book.published);
    if (year) {
      regexParsed++;
      updates.push({ id: book._id, year, source: 'regex' });
    } else {
      needsGemini.push(book);
    }
  }

  console.log(`Phase 1 (regex): ${regexParsed} parsed, ${needsGemini.length} need Gemini`);

  // Phase 2: Gemini for ambiguous
  if (needsGemini.length > 0 && apiKeys.length > 0) {
    console.log(`Phase 2 (Gemini): processing ${needsGemini.length} books in batches of ${GEMINI_BATCH_SIZE}...`);

    for (let i = 0; i < needsGemini.length; i += GEMINI_BATCH_SIZE) {
      const batch = needsGemini.slice(i, i + GEMINI_BATCH_SIZE);
      const results = await inferYearsWithGemini(batch);

      for (const book of batch) {
        const id = book._id.toString();
        if (results[id]) {
          geminiParsed++;
          updates.push({ id: book._id, year: results[id], source: 'gemini' });
        } else {
          failed++;
        }
      }

      const progress = Math.min(i + GEMINI_BATCH_SIZE, needsGemini.length);
      process.stdout.write(`  ${progress}/${needsGemini.length} processed\r`);

      if (i + GEMINI_BATCH_SIZE < needsGemini.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log();
  } else if (needsGemini.length > 0) {
    failed = needsGemini.length;
    console.log('No Gemini API key — skipping AI inference');
  }

  console.log(`\nResults: ${regexParsed} regex + ${geminiParsed} Gemini = ${updates.length} total, ${failed} unresolved`);

  // Show sample
  console.log('\nSample updates:');
  for (const u of updates.slice(0, 10)) {
    const book = candidates.find(b => b._id.equals(u.id));
    console.log(`  "${book.published}" → ${u.year} (${u.source}) — ${book.title?.slice(0, 60)}`);
  }

  // Show unresolved
  if (failed > 0) {
    console.log(`\nSample unresolved (${failed} total):`);
    const unresolved = needsGemini.filter(b => !updates.find(u => u.id.equals(b._id)));
    for (const b of unresolved.slice(0, 10)) {
      console.log(`  published="${b.published}" — ${b.title?.slice(0, 60)}`);
    }
  }

  // Apply
  if (!dryRun && updates.length > 0) {
    console.log(`\nWriting ${updates.length} updates...`);
    const bulkOps = updates.map(u => ({
      updateOne: {
        filter: { _id: u.id },
        update: { $set: { year: u.year, year_source: u.source } }
      }
    }));

    const result = await books.bulkWrite(bulkOps, { ordered: false });
    console.log(`Modified: ${result.modifiedCount}`);
  }

  await client.close();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
