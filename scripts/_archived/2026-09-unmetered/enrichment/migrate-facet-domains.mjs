#!/usr/bin/env node
/**
 * Migrate faceted_tags.knowledge_domain to revised cross-cultural vocabulary.
 *
 * Simple renames (no AI needed):
 *   theology      → sacred
 *   natural-science → cosmos
 *   law-politics   → governance
 *
 * Split (needs Gemini):
 *   esoteric-arts  → practice OR divination (per-book classification)
 *
 * Unchanged: philosophy, medicine, mathematics, history, literature, military
 *
 * Also updates tag_sources to record the migration.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/migrate-facet-domains.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/migrate-facet-domains.mjs --dry-run
 *
 * Ref: GitHub issue #368
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const DRY_RUN = args['dry-run'] === 'true';

// ─── Step 1: Simple Renames ──────────────────────────────────────

const RENAMES = {
  'theology': 'sacred',
  'natural-science': 'cosmos',
  'law-politics': 'governance',
};

async function doRenames(db) {
  console.log('=== Step 1: Simple Renames ===\n');

  for (const [oldVal, newVal] of Object.entries(RENAMES)) {
    const count = await db.collection('books').countDocuments({
      'faceted_tags.knowledge_domain': oldVal,
    });
    console.log(`  ${oldVal} → ${newVal}: ${count} books`);

    if (!DRY_RUN && count > 0) {
      // Use arrayFilters to rename within the array
      await db.collection('books').updateMany(
        { 'faceted_tags.knowledge_domain': oldVal },
        { $set: { 'faceted_tags.knowledge_domain.$[elem]': newVal } },
        { arrayFilters: [{ elem: oldVal }] }
      );
    }
  }
  console.log('');
}

// ─── Step 2: Split esoteric-arts → practice / divination ─────────

const SPLIT_PROMPT = `You are classifying books in Source Library. Each book was previously tagged "esoteric-arts" — a category we're splitting into two:

**practice** — Contemplation & Practice: meditation, ritual, spiritual exercises, inner alchemy, self-cultivation, operative technique, lab work, grimoire instructions, magical operations, transformative practice
**divination** — Divination & Astrology: astrology, horoscopes, geomancy, omen reading, Yi Jing, correspondences, haruspicy, fortune-telling, celestial interpretation, prognostication

The key distinction: **divination** is about READING/KNOWING (interpreting signs, predicting). **practice** is about DOING/BECOMING (transforming self, matter, or the world).

Some books may be BOTH (e.g., astrological magic combines divination with ritual practice). In that case, return both.

For each book, return which domain(s) apply. Respond with a JSON array: [{ "index": <number>, "domains": ["practice"] }] or [{ "index": 0, "domains": ["practice", "divination"] }]
Keep responses compact. Return ONLY valid JSON.`;

function parseJsonLenient(text) {
  try { return JSON.parse(text); } catch {}
  const stripped = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const lastComplete = stripped.lastIndexOf('}');
  if (lastComplete > 0) {
    const truncated = stripped.slice(0, lastComplete + 1) + ']';
    try { return JSON.parse(truncated); } catch {}
  }
  throw new Error(`Unparseable JSON (${text.length} chars)`);
}

async function callGemini(userPrompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SPLIT_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = attempt * 5000;
        console.log(`  Gemini ${res.status}, retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      return parseJsonLenient(text);
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Attempt ${attempt} failed: ${err.message}, retrying...`);
      await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
}

async function splitEsotericArts(db) {
  console.log('=== Step 2: Split esoteric-arts → practice / divination ===\n');

  const books = await db.collection('books').find(
    { 'faceted_tags.knowledge_domain': 'esoteric-arts' },
    { projection: {
      title: 1, author: 1, language: 1, categories: 1,
      'reading_summary.overview': 1,
      'faceted_tags.knowledge_domain': 1,
      'faceted_tags.tradition': 1,
    }}
  ).sort({ _id: 1 }).toArray();

  console.log(`  Books to split: ${books.length}\n`);

  const BATCH_SIZE = 10;
  const stats = { practice: 0, divination: 0, both: 0, failed: 0 };

  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    const batch = books.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(books.length / BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches}... `);

    const lines = batch.map((b, idx) => {
      const parts = [`[${idx}] "${b.title}"`];
      if (b.author) parts.push(`by ${b.author}`);
      if (b.language) parts.push(`(${b.language})`);
      if (b.categories?.length) parts.push(`Categories: ${b.categories.join(', ')}`);
      if (b.faceted_tags?.tradition?.length) parts.push(`Traditions: ${b.faceted_tags.tradition.join(', ')}`);
      const overview = b.reading_summary?.overview;
      if (overview) {
        parts.push(`\nSummary: ${overview.length > 200 ? overview.slice(0, 197) + '...' : overview}`);
      }
      return parts.join(' ');
    });

    const prompt = `Classify these ${batch.length} books as "practice", "divination", or both:\n\n${lines.join('\n\n')}`;

    try {
      const results = await callGemini(prompt);
      if (!Array.isArray(results)) { stats.failed += batch.length; console.log('ERROR'); continue; }

      for (const result of results) {
        const idx = result.index;
        if (idx == null || idx < 0 || idx >= batch.length) continue;
        const book = batch[idx];
        const domains = (result.domains || []).filter(d => d === 'practice' || d === 'divination');
        if (!domains.length) { stats.failed++; continue; }

        if (domains.length === 2) stats.both++;
        else if (domains[0] === 'practice') stats.practice++;
        else stats.divination++;

        if (!DRY_RUN) {
          // Replace 'esoteric-arts' in the array with the new domain(s)
          const currentDomains = book.faceted_tags?.knowledge_domain || [];
          const newDomains = [
            ...currentDomains.filter(d => d !== 'esoteric-arts'),
            ...domains,
          ];
          // Deduplicate
          const unique = [...new Set(newDomains)];

          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: {
              'faceted_tags.knowledge_domain': unique,
              'tag_sources.knowledge_domain_migration': 'domain_v2_split',
            }}
          );
        }
      }
      console.log(`OK (${results.length} results)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      stats.failed += batch.length;
    }

    if (i + BATCH_SIZE < books.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`\n  Practice only: ${stats.practice}`);
  console.log(`  Divination only: ${stats.divination}`);
  console.log(`  Both: ${stats.both}`);
  console.log(`  Failed: ${stats.failed}`);
}

// ─── Step 3: Verify ──────────────────────────────────────────────

async function verify(db) {
  console.log('\n=== Verification ===\n');

  const OLD_DOMAINS = ['theology', 'natural-science', 'law-politics', 'esoteric-arts'];
  for (const old of OLD_DOMAINS) {
    const remaining = await db.collection('books').countDocuments({
      'faceted_tags.knowledge_domain': old,
    });
    console.log(`  ${old}: ${remaining} remaining${remaining === 0 ? ' ✓' : ' ← NEEDS ATTENTION'}`);
  }

  const NEW_DOMAINS = ['cosmos', 'sacred', 'governance', 'practice', 'divination',
    'philosophy', 'medicine', 'mathematics', 'history', 'literature', 'military'];
  console.log('\nNew domain distribution:');
  for (const domain of NEW_DOMAINS) {
    const count = await db.collection('books').countDocuments({
      'faceted_tags.knowledge_domain': domain,
    });
    if (count > 0) console.log(`  ${String(count).padStart(6)} ${domain}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Domain Vocabulary Migration (v1 → v2) ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  await doRenames(db);
  await splitEsotericArts(db);
  await verify(db);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
