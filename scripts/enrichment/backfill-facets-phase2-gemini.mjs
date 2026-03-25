#!/usr/bin/env node
/**
 * Facet Redesign Phase 2: Gemini-powered domain & tradition tagging.
 *
 * Reads existing reading_summary (overview + themes) for texts that Phase 1
 * couldn't classify via category mapping alone. Uses Gemini Flash to assign
 * knowledge_domain and optionally tradition facets.
 *
 * Only targets books/manuscripts with faceted_tags.material_type but missing
 * knowledge_domain. Merges into existing faceted_tags via dot-notation $set.
 *
 * Estimated cost: ~$0.70 for full library (~4,400 books × ~200 input tokens).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase2-gemini.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase2-gemini.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-facets-phase2-gemini.mjs --limit=100
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
const LIMIT = args.limit ? parseInt(args.limit) : 0;
const BATCH_SIZE = args.batch ? parseInt(args.batch) : 10;

// ─── Controlled Vocabulary (must match Phase 1) ──────────────────

const VALID_DOMAINS = [
  'theology', 'philosophy', 'natural-science', 'medicine', 'mathematics',
  'history', 'literature', 'law-politics', 'esoteric-arts', 'military',
];

const VALID_TRADITIONS = [
  'hermetic', 'alchemical', 'kabbalistic', 'neoplatonic', 'rosicrucian',
  'masonic', 'theosophical', 'gnostic', 'pythagorean', 'paracelsian',
  'sufi', 'vedic', 'buddhist', 'daoist', 'confucian',
  'christian-mystical', 'manichaean', 'enlightenment',
];

// ─── System Prompt ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a librarian classifying books in Source Library, a digital library of historical texts spanning alchemy, philosophy, science, mysticism, and world traditions from antiquity to 1900.

For each book, assign:
1. **knowledge_domain** (1-3 values, REQUIRED): The subject matter of the text.
2. **tradition** (0-3 values, OPTIONAL): The intellectual/spiritual lineage, if applicable. Many texts (secular history, pure science, law) have NO tradition — return an empty array.

Use ONLY the IDs listed below. Never invent new ones.

### Knowledge Domain (pick 1-3)
- theology: Theology & scripture — God, salvation, doctrine, church, biblical commentary
- philosophy: Philosophy — metaphysics, ethics, logic, epistemology, political philosophy
- natural-science: Natural science — physics, chemistry, botany, zoology, astronomy, geography, optics
- medicine: Medicine — anatomy, pharmacology, herbalism, surgery, healing
- mathematics: Mathematics — arithmetic, geometry, music theory, sacred geometry
- history: History — chronicles, biography, historiography, antiquarian studies
- literature: Literature — poetry, rhetoric, grammar, letters, literary prose, drama
- law-politics: Law & politics — jurisprudence, governance, political theory
- esoteric-arts: Esoteric arts — alchemy, astrology, magic, divination, ritual, occult sciences
- military: Military science — strategy, fortification, weapons, naval warfare

### Tradition (pick 0-3, empty array if none fits)
- hermetic: Hermetica — Hermes Trismegistus, Corpus Hermeticum, Asclepius
- alchemical: Alchemical — transmutation, Great Work, philosopher's stone
- kabbalistic: Kabbalistic — Sefirot, Zohar, Jewish mysticism
- neoplatonic: Neoplatonic — emanation, Plotinus, Proclus, Ficino
- rosicrucian: Rosicrucian — Rosy Cross brotherhood, manifestos
- masonic: Masonic — Freemasonry, lodge rituals, fraternal initiation
- theosophical: Theosophical — Blavatsky or Boehme's theosophy
- gnostic: Gnostic — salvation through knowledge, demiurge, pleroma
- pythagorean: Pythagorean — number as principle, harmony of spheres
- paracelsian: Paracelsian — iatrochemistry, tria prima, signatures
- sufi: Sufi — Islamic mysticism, Rumi, Ibn Arabi
- vedic: Vedic/Hindu — Vedas, Upanishads, yoga, tantra
- buddhist: Buddhist — Dharma, sutras, Mahayana, Theravada, Vajrayana
- daoist: Daoist — Dao, wu wei, inner alchemy, Laozi, Zhuangzi
- confucian: Confucian — Confucius, li, ren, the Five Classics
- christian-mystical: Christian mystical — Eckhart, Boehme, Dionysius, direct experience of God
- manichaean: Manichaean — Mani, light/dark dualism, Dunhuang texts
- enlightenment: New Thought/Spiritualist — mental science, mesmerism, occult revival

Respond with a JSON array. Each element: { "index": <number>, "knowledge_domain": [...], "tradition": [...] }
Keep responses compact — use tag IDs only, no explanations. Return ONLY valid JSON, no markdown fences.`;

// ─── JSON Repair (handles truncated Gemini output) ───────────────

function parseJsonLenient(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}

  // Strip markdown fences if present
  const stripped = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  try { return JSON.parse(stripped); } catch {}

  // Try to salvage a truncated JSON array by finding the last complete object
  const lastComplete = stripped.lastIndexOf('}');
  if (lastComplete > 0) {
    const truncated = stripped.slice(0, lastComplete + 1) + ']';
    try { return JSON.parse(truncated); } catch {}
  }

  throw new Error(`Unparseable JSON (${text.length} chars): ${text.slice(-80)}`);
}

// ─── Gemini API Call ─────────────────────────────────────────────

async function callGemini(userPrompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
        console.log(`  Gemini ${res.status}, retrying in ${wait/1000}s...`);
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

// ─── Build Prompt for a Batch ────────────────────────────────────

function buildBatchPrompt(books) {
  const lines = books.map((b, i) => {
    const parts = [`[${i}] "${b.title}"`];
    if (b.author) parts.push(`by ${b.author}`);
    if (b.language) parts.push(`(${b.language})`);
    if (b.published) parts.push(`published ${b.published}`);

    // Add summary context if available
    const overview = b.reading_summary?.overview;
    if (overview) {
      // Truncate to ~300 chars to keep tokens reasonable
      const trimmed = overview.length > 300 ? overview.slice(0, 297) + '...' : overview;
      parts.push(`\nSummary: ${trimmed}`);
    }

    const themes = b.reading_summary?.themes;
    if (themes?.length) {
      parts.push(`Themes: ${themes.slice(0, 8).join(', ')}`);
    }

    // Include existing categories as hint
    if (b.categories?.length) {
      parts.push(`Categories: ${b.categories.join(', ')}`);
    }

    return parts.join(' ');
  });

  return `Classify these ${books.length} books. Return a JSON array with one object per book.\n\n${lines.join('\n\n')}`;
}

// ─── Validate & Filter Results ───────────────────────────────────

function validateResult(result) {
  const domains = (result.knowledge_domain || []).filter(d => VALID_DOMAINS.includes(d));
  const traditions = (result.tradition || []).filter(t => VALID_TRADITIONS.includes(t));

  return {
    knowledge_domain: domains.slice(0, 3),
    tradition: traditions.slice(0, 3),
  };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Facet Phase 2: Gemini Domain & Tradition Tagging ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Target: texts (book/manuscript) that have faceted_tags but no knowledge_domain
  const query = {
    hidden: { $ne: true },
    'faceted_tags.material_type': { $in: ['book', 'manuscript'] },
    $or: [
      { 'faceted_tags.knowledge_domain': { $exists: false } },
      { 'faceted_tags.knowledge_domain': { $size: 0 } },
    ],
  };

  const total = await db.collection('books').countDocuments(query);
  console.log(`Texts needing domain tagging: ${total}`);

  const pipeline = [
    { $match: query },
    { $project: {
      id: 1,
      title: 1,
      author: 1,
      language: 1,
      published: 1,
      categories: 1,
      'reading_summary.overview': 1,
      'reading_summary.themes': 1,
      'faceted_tags': 1,
    }},
    { $sort: { _id: 1 } },
  ];
  if (LIMIT) pipeline.push({ $limit: LIMIT });

  const books = await db.collection('books').aggregate(pipeline).toArray();
  console.log(`Processing: ${books.length}\n`);

  // Split into those with summaries (better tagging) and those without
  const withSummary = books.filter(b => b.reading_summary?.overview);
  const withoutSummary = books.filter(b => !b.reading_summary?.overview);
  console.log(`  With reading_summary: ${withSummary.length}`);
  console.log(`  Without (title+categories only): ${withoutSummary.length}\n`);

  const stats = { tagged: 0, domainOnly: 0, withTradition: 0, failed: 0 };
  const domainCounts = {};
  const traditionCounts = {};

  // Process summaries first (larger context → smaller batches), then title-only
  const allBooks = [...withSummary, ...withoutSummary];
  let processed = 0;

  for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
    const batch = allBooks.slice(i, i + BATCH_SIZE);
    processed++;
    const totalBatches = Math.ceil(allBooks.length / BATCH_SIZE);

    process.stdout.write(`Batch ${processed}/${totalBatches} (${batch.length} books)... `);

    try {
      const prompt = buildBatchPrompt(batch);
      const results = await callGemini(prompt);

      if (!Array.isArray(results)) {
        console.log('ERROR: non-array response');
        stats.failed += batch.length;
        continue;
      }

      for (const result of results) {
        const idx = result.index;
        if (idx == null || idx < 0 || idx >= batch.length) continue;

        const book = batch[idx];
        const validated = validateResult(result);

        if (validated.knowledge_domain.length === 0) {
          stats.failed++;
          continue;
        }

        // Count domains (always written)
        for (const d of validated.knowledge_domain) {
          domainCounts[d] = (domainCounts[d] || 0) + 1;
        }

        // Only count tradition if it will actually be written (Phase 1 didn't set one)
        const willWriteTradition = validated.tradition.length > 0 && !book.faceted_tags?.tradition?.length;
        if (willWriteTradition) {
          for (const t of validated.tradition) {
            traditionCounts[t] = (traditionCounts[t] || 0) + 1;
          }
        }

        stats.tagged++;
        if (willWriteTradition) {
          stats.withTradition++;
        } else {
          stats.domainOnly++;
        }

        if (!DRY_RUN) {
          const update = {
            'faceted_tags.knowledge_domain': validated.knowledge_domain,
            'faceted_tags.tag_sources.knowledge_domain': 'gemini',
            'faceted_tags.tagged_at': new Date(),
          };

          if (willWriteTradition) {
            update['faceted_tags.tradition'] = validated.tradition;
            update['faceted_tags.tag_sources.tradition'] = 'gemini';
          }

          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: update }
          );
        }
      }

      console.log(`OK (${results.length} results)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      stats.failed += batch.length;
    }

    // Rate limit: 100ms between batches
    if (i + BATCH_SIZE < allBooks.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ─── Results ─────────────────────────────────────────────────────
  console.log('\n=== Results ===\n');
  console.log(`Tagged: ${stats.tagged} (${stats.domainOnly} domain-only, ${stats.withTradition} with tradition)`);
  console.log(`Failed: ${stats.failed}`);

  console.log('\nKnowledge Domain distribution:');
  for (const [k, v] of Object.entries(domainCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)} ${k}`);
  }

  console.log('\nTradition distribution (Gemini-assigned):');
  for (const [k, v] of Object.entries(traditionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(6)} ${k}`);
  }

  // Show coverage after this run
  const totalTexts = await db.collection('books').countDocuments({
    hidden: { $ne: true },
    'faceted_tags.material_type': { $in: ['book', 'manuscript'] },
  });
  const withDomain = await db.collection('books').countDocuments({
    hidden: { $ne: true },
    'faceted_tags.knowledge_domain.0': { $exists: true },
  });
  console.log(`\nOverall domain coverage: ${withDomain}/${totalTexts} texts (${Math.round(withDomain/totalTexts*100)}%)`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
