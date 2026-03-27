#!/usr/bin/env node
/**
 * Phase 2: Gemini-powered domain tagger for books not covered by category mapping.
 *
 * Sends books in batches of 10 to Gemini with title, author, year, language,
 * summary, and existing categories. Writes back faceted_tags.knowledge_domain
 * with field_provenance.
 *
 * Uses gemini-3-flash-preview (the default model for all AI tasks).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/gemini-domain-tagger.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/gemini-domain-tagger.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/gemini-domain-tagger.mjs --limit=100
 *
 * Cost estimate: ~3,459 books / 10 per batch = 346 calls × ~1K tokens = ~$0.50-2.00
 *
 * Ref: GitHub issue #368
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = parseInt(args['limit'] || '0');
const BATCH_SIZE = 10;
const MODEL = 'gemini-3-flash-preview';

// ─── Valid domain IDs (must match faceted-vocabulary.ts) ─────────

const VALID_DOMAINS = new Set([
  'philosophy', 'theology', 'mysticism', 'cosmology', 'history',
  'astronomy', 'mathematics', 'medicine', 'pharmacology', 'natural-history',
  'natural-philosophy', 'chemistry', 'geography',
  'alchemy', 'astrology', 'magic', 'divination', 'kabbalah',
  'hermeticism', 'neoplatonism', 'esotericism', 'freemasonry', 'rosicrucianism', 'theosophy',
  'scripture', 'devotion', 'prophecy',
  'daoism', 'buddhism', 'sufism', 'gnosticism', 'demonology',
  'politics', 'military', 'law', 'economics', 'architecture',
  'literature', 'language', 'music', 'art', 'technology', 'education',
  'encyclopedia', 'bibliography',
  'cryptography', 'printing', 'emblematics',
]);

// ─── System prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a librarian classifying books in Source Library, a digital library of historical texts spanning alchemy, philosophy, science, mysticism, and world traditions from antiquity to 1900.

Assign 1-3 knowledge domain tags to each book. Use ONLY these domain IDs:

**Philosophy & Thought:** philosophy, theology, mysticism, cosmology, history
**Science & Nature:** astronomy, mathematics, medicine, pharmacology, natural-history, natural-philosophy, chemistry, geography
**The Hidden Arts:** alchemy, astrology, magic, divination, kabbalah
**Esoteric Currents:** hermeticism, neoplatonism, esotericism, freemasonry, rosicrucianism, theosophy
**Sacred & Devotional:** scripture, devotion, prophecy
**World Knowledge Systems:** daoism, buddhism, sufism, gnosticism, demonology
**Human Affairs:** politics, military, law, economics, architecture
**Language, Art & Culture:** literature, language, music, art, technology, education
**Reference:** encyclopedia, bibliography
**Material & Manuscript:** cryptography, printing, emblematics

Rules:
- Use 1-3 domain IDs per book. Prefer precision over coverage.
- For Dunhuang manuscripts: classify by actual content (buddhism, devotion, literature, etc.), NOT by collection name.
- For Manichaean texts: use gnosticism (NOT buddhism even if found in Buddhist caves).
- Chinese, Sanskrit, Arabic texts get the same domain IDs as Latin texts — domains are subject-based, not culture-based.
- Respond with valid JSON only. No explanation.`;

// ─── Main ───────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function classifyBatch(books) {
  const bookEntries = books.map(b => {
    const parts = [
      `ID: ${b.id}`,
      `Title: ${b.title}`,
      b.display_title ? `English title: ${b.display_title}` : null,
      b.author ? `Author: ${b.author}` : null,
      b.published ? `Year: ${b.published}` : null,
      b.language ? `Language: ${b.language}` : null,
      b.categories?.length ? `Categories: ${b.categories.join(', ')}` : null,
      b.summary ? `Summary: ${(typeof b.summary === 'string' ? b.summary : '').slice(0, 300)}` : null,
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n---\n');

  const userPrompt = `Tag these books with 1-3 domain IDs each. Return JSON array:
[{ "id": "book_id", "domains": ["domain1", "domain2"] }, ...]

${bookEntries}`;

  const model = genAI.getGenerativeModel({ model: MODEL });

  // Wrap in timeout — Gemini sometimes hangs
  const apiCall = model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini API timeout (30s)')), 30000)
  );
  const result = await Promise.race([apiCall, timeoutPromise]);

  const text = result.response.text();
  const usage = result.response.usageMetadata;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try extracting JSON array from text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error(`Failed to parse response: ${text.slice(0, 200)}`);
  }

  return { results: parsed, inputTokens: usage?.promptTokenCount || 0, outputTokens: usage?.candidatesTokenCount || 0 };
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log(`=== Gemini Domain Tagger (Phase 2) ===`);
  console.log(`Model: ${MODEL}`);
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Find books without valid v2 domains
  const allBooks = await db.collection('books').find(
    { pages_count: { $gt: 0 }, hidden: { $ne: true } },
    { projection: {
      _id: 1, id: 1, title: 1, display_title: 1, author: 1, published: 1,
      language: 1, categories: 1, summary: 1,
      'faceted_tags.knowledge_domain': 1,
    }}
  ).toArray();

  const needsTagging = allBooks.filter(b => {
    const domains = b.faceted_tags?.knowledge_domain || [];
    return domains.length === 0 || !domains.every(d => VALID_DOMAINS.has(d));
  });

  const books = LIMIT > 0 ? needsTagging.slice(0, LIMIT) : needsTagging;
  console.log(`Books needing tagging: ${needsTagging.length}`);
  console.log(`Processing: ${books.length}\n`);

  let totalInput = 0, totalOutput = 0;
  let tagged = 0, errors = 0, skipped = 0;
  const domainCounts = new Map();

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(books.length / BATCH_SIZE);

    try {
      const { results, inputTokens, outputTokens } = await classifyBatch(batch);
      totalInput += inputTokens;
      totalOutput += outputTokens;

      // Create a map of book ID → domains from the response
      const resultMap = new Map();
      for (const r of results) {
        if (r.id && Array.isArray(r.domains)) {
          const valid = r.domains.filter(d => VALID_DOMAINS.has(d)).slice(0, 3);
          if (valid.length > 0) resultMap.set(r.id, valid);
        }
      }

      // Write results
      for (const book of batch) {
        const domains = resultMap.get(book.id);
        if (!domains) {
          skipped++;
          continue;
        }

        for (const d of domains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);

        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { _id: book._id },
            {
              $set: {
                'faceted_tags.knowledge_domain': domains,
                'field_provenance.knowledge_domain': {
                  source: 'gemini_tagger_v2',
                  method: 'ai_classification',
                  model: MODEL,
                  confidence: 0.8,
                  date: new Date(),
                },
              },
            }
          );
        }
        tagged++;
      }

      console.log(`Batch ${batchNum}/${totalBatches}: ${results.length} results, in:${inputTokens} out:${outputTokens}`);
    } catch (err) {
      errors++;
      console.error(`Batch ${batchNum}/${totalBatches}: ERROR — ${err.message?.slice(0, 100)}`);
      // Small delay on error to avoid hammering
      await new Promise(r => setTimeout(r, 2000));
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < books.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // ─── Report ─────────────────────────────────────────────────────

  console.log('\n=== Results ===\n');
  console.log(`  Tagged:   ${tagged}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Tokens:   ${totalInput} in / ${totalOutput} out`);

  const costEstimate = (totalInput * 0.15 / 1_000_000) + (totalOutput * 0.6 / 1_000_000);
  console.log(`  Est cost: $${costEstimate.toFixed(4)}`);

  if (domainCounts.size > 0) {
    console.log('\n=== Domain Distribution (this run) ===\n');
    const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [domain, count] of sorted) {
      console.log(`  ${String(count).padStart(6)} ${domain}`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
