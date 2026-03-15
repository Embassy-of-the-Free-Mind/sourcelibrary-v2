#!/usr/bin/env node
/**
 * Batch backfill collection relevance scores for all books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-collection-relevance.mjs
 *
 * Options:
 *   --limit N        Process at most N books (default: all)
 *   --concurrency N  Parallel Gemini calls (default: 5)
 *   --force          Re-score books that already have scores
 *   --collection X   Only score books in collection X
 *   --dry-run        Show what would be processed without calling Gemini
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !GEMINI_API_KEY) {
  console.error('Missing MONGODB_URI or GEMINI_API_KEY');
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const limit = parseInt(getArg('limit') || '0', 10);
const concurrency = parseInt(getArg('concurrency') || '5', 10);
const force = hasFlag('force');
const filterCollection = getArg('collection');
const dryRun = hasFlag('dry-run');

// Rotate API keys for throughput
const apiKeys = [GEMINI_API_KEY];
for (let i = 2; i <= 10; i++) {
  const key = process.env[`GEMINI_API_KEY_${i}`];
  if (key) apiKeys.push(key);
}
console.log(`Using ${apiKeys.length} API key(s), concurrency=${concurrency}`);

// Dynamic import of the scoring module (TypeScript via tsx)
async function scoreBook(db, bookId, apiKey) {
  // We can't import TS directly from mjs, so we inline a simplified version
  // that calls Gemini directly. This avoids needing tsx.
  return await scoreCollectionRelevanceRaw(db, bookId, apiKey);
}

// ============================================================
// Inline scoring logic (mirrors src/lib/collection-relevance.ts)
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = 'gemini-3-flash-preview';

const COLLECTIONS = [
  { slug: 'alchemy', name: 'Alchemy', desc: 'Transmutation, chrysopoeia, spagyrics, laboratory practice, philosophical alchemy' },
  { slug: 'hermetica', name: 'Hermetica', desc: 'Corpus Hermeticum, Pymander, Asclepius, prisca theologia, Hermetic philosophy' },
  { slug: 'kabbalah', name: 'Kabbalah', desc: 'Jewish Kabbalah, Christian Cabala, Sefirot, Zohar, letter mysticism' },
  { slug: 'magic', name: 'Magic & Occult Arts', desc: 'Grimoires, natural magic, ceremonial magic, talismans, conjuration' },
  { slug: 'natural-philosophy', name: 'Natural Philosophy & Science', desc: 'Physics, optics, mechanics, cosmology, Aristotelian and early modern science' },
  { slug: 'demonology', name: 'Demonology & Witchcraft', desc: 'Witch trials, possession, exorcism, demonological treatises' },
  { slug: 'secret-societies', name: 'Secret Societies', desc: 'Freemasonry, Rosicrucians, Illuminati, fraternal orders' },
  { slug: 'astrology', name: 'Astrology & Divination', desc: 'Horoscopes, celestial science, geomancy, augury, prognostication' },
  { slug: 'mysticism', name: 'Mysticism', desc: 'Direct divine experience, contemplative practice, visionary literature' },
  { slug: 'sacred-texts', name: 'Sacred Texts', desc: 'Scriptures, canonical commentaries, liturgical texts (use traditions for specific religions)' },
  { slug: 'theology', name: 'Theology & Religious Thought', desc: 'Scholasticism, Reformation, apologetics, church history, doctrinal works' },
  { slug: 'classical-philosophy', name: 'Classical Philosophy', desc: 'Plato, Aristotle, Stoics, Neoplatonists, pre-Socratics, ancient Greek/Roman thought' },
  { slug: 'renaissance-philosophy', name: 'Renaissance Philosophy', desc: 'Ficino, Pico, Florentine Platonism, humanism, Renaissance intellectuals' },
  { slug: 'medicine', name: 'Medicine & Natural History', desc: 'Anatomy, pharmacology, Paracelsian medicine, herbalism, zoology, mineralogy' },
  { slug: 'indic-traditions', name: 'Indic Traditions', desc: 'Vedas, yoga, tantra, Ayurveda, Sanskrit philosophical traditions' },
  { slug: 'chinese-classics', name: 'Chinese Classics', desc: 'Confucian canon, Daoist texts, Chinese Buddhist texts, classical Chinese thought' },
  { slug: 'art-illustrated', name: 'Art & Illustrated Books', desc: 'Emblem books, engravings, visual encyclopedias, illustrated manuscripts' },
  { slug: 'literature', name: 'Literature & Poetry', desc: 'Epic poetry, allegory, early fiction, drama, literary texts' },
  { slug: 'music-harmony', name: 'Music, Harmony & Resonance', desc: 'Music theory, Pythagorean harmonics, acoustic science' },
  { slug: 'herbalism', name: 'Herbalism & Botany', desc: 'Herbals, materia medica, botanical illustration, plant taxonomy' },
  { slug: 'leonardo-da-vinci', name: 'Leonardo da Vinci', desc: 'Manuscripts, codices, treatises by Leonardo da Vinci' },
  { slug: 'shwep', name: 'SHWEP Reading Room', desc: 'Primary sources discussed on the Secret History of Western Esotericism Podcast' },
];

const TRADITIONS = [
  'christianity', 'judaism', 'islam', 'buddhism', 'hinduism', 'daoism',
  'zoroastrianism', 'hermetica-sacred', 'manichaeism', 'mandaeanism',
  'jainism', 'confucianism', 'ancient-egyptian', 'orphism-mysteries',
  'norse-germanic', 'shinto', 'sikhism', 'indigenous-traditions',
  'druze', 'bahai', 'sumerian-mesopotamian', 'ancient-greek-religion',
  'celtic', 'tengrism', 'yazidi', 'polynesian', 'samaritan', 'cao-dai',
];

async function scoreCollectionRelevanceRaw(db, bookId, apiKey) {
  const book = await db.collection('books').findOne(
    { id: bookId },
    {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        is_first_translation: 1, collections: 1, reading_summary: 1,
        index: 1, chapters: 1, gallery_image_count: 1,
      },
    },
  );
  if (!book) return { success: false, bookId, error: 'Not found' };

  // Title page OCR
  const titlePages = await db.collection('pages')
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1 } },
    )
    .sort({ page_number: 1 })
    .limit(3)
    .toArray();

  const titlePageText = titlePages.map(p => (p.ocr?.data || '').slice(0, 2000)).join('\n---\n');

  // Index/TOC
  let indexText = '';
  if (book.chapters?.length > 0) {
    indexText = book.chapters.map(ch => `${ch.titleEn || ch.title} (p.${ch.pageNumber})`).join('\n');
  } else if (book.index?.entries?.length > 0) {
    indexText = book.index.entries.slice(0, 50).map(e => e.term).join(', ');
  }

  const summary = book.reading_summary?.overview || '';
  const illustrations = book.gallery_image_count || 0;

  const collectionList = COLLECTIONS.map(c => `- ${c.slug}: ${c.name} — ${c.desc}`).join('\n');
  const traditionList = TRADITIONS.map(t => `- ${t}`).join('\n');

  const prompt = `You are a librarian classifying a historical book into thematic collections.

## Book Information
**Title:** ${book.display_title || book.title}
**Author:** ${book.author || 'Unknown'}
**Language:** ${book.language || 'Unknown'}
**Year:** ${book.published || 'Unknown'}
**Pages:** ${book.pages_count || 'Unknown'}
**Illustrations:** ${illustrations}
**Summary:** ${(summary).slice(0, 500)}

## Title Page Text
${titlePageText || '[No OCR available]'}

## Table of Contents / Index
${indexText?.slice(0, 3000) || '[No index available]'}

## Available Collections
${collectionList}

## Sacred Text Traditions (subcollections of sacred-texts)
${traditionList}

## Instructions

Classify this book. Be opinionated — a book about "Christian astrology" is primarily an ASTROLOGY book, not a Christianity book.

Respond in JSON:

{
  "primary_collection": "slug of the single best collection",
  "scores": {
    "collection-slug": {
      "relevance": 0-100,
      "role": "primary|secondary|related",
      "reasoning": "one sentence"
    }
  },
  "sacred_text_type": null or {
    "tradition": "tradition-slug",
    "type": "scripture|canonical_commentary|liturgical|devotional|scholarly",
    "confidence": "high|medium|low"
  }
}

Rules:
- Only include collections where relevance >= 15. Omit irrelevant ones.
- Exactly ONE collection should have role "primary".
- "secondary" = substantially engages (40-70). "related" = touches on (15-39).
- 80+ = landmark text for that collection.
- sacred_text_type: only if genuinely a scripture, prayer book, or canonical commentary — not scholarship ABOUT a religion.
- "scripture" = foundational holy text. "canonical_commentary" = authoritative traditional commentary.
- "liturgical" = prayer/ritual texts. "devotional" = popular devotional. "scholarly" = academic study (NOT sacred).

Respond ONLY with valid JSON, no markdown fences.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    const scores = {};
    for (const [slug, s] of Object.entries(parsed.scores || {})) {
      if (s.relevance >= 15) {
        let relevance = Math.min(100, Math.max(0, Math.round(s.relevance)));
        // Mechanical boosters
        if (illustrations > 10) relevance = Math.min(100, relevance + 3);
        if (illustrations > 50) relevance = Math.min(100, relevance + 5);
        if (slug === 'art-illustrated' && illustrations > 5) relevance = Math.min(100, relevance + 10);
        if (book.is_first_translation) relevance = Math.min(100, relevance + 5);
        if (book.pages_count > 100) relevance = Math.min(100, relevance + 2);
        if (book.pages_count > 300) relevance = Math.min(100, relevance + 3);

        scores[slug] = { relevance, role: s.role, reasoning: s.reasoning || '' };
      }
    }

    // Update collections: primary + secondary become the book's collections
    const newCollections = Object.entries(scores)
      .filter(([, s]) => s.role === 'primary' || s.role === 'secondary')
      .map(([slug]) => slug);

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          collection_scores: scores,
          collection_primary: parsed.primary_collection,
          sacred_text_type: parsed.sacred_text_type || null,
          collections: newCollections,
          'collection_scores_meta': { model: MODEL, scored_at: new Date() },
        },
      },
    );

    return { success: true, bookId, primary: parsed.primary_collection, scores: Object.keys(scores).length, sacred: parsed.sacred_text_type?.type || null };
  } catch (err) {
    return { success: false, bookId, error: err.message };
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  // Build query
  const query = { pages_ocr: { $gt: 0 } };
  if (!force) query.collection_scores = { $exists: false };
  if (filterCollection) query.collections = filterCollection;

  const total = await db.collection('books').countDocuments(query);
  console.log(`Found ${total} books to process${limit ? ` (limit: ${limit})` : ''}`);

  if (dryRun) {
    const sample = await db.collection('books')
      .find(query, { projection: { id: 1, title: 1, collections: 1 } })
      .limit(20)
      .toArray();
    for (const b of sample) {
      console.log(`  ${b.title?.slice(0, 60)} [${(b.collections || []).join(', ')}]`);
    }
    if (total > 20) console.log(`  ... and ${total - 20} more`);
    client.close();
    return;
  }

  // Fetch all IDs upfront to avoid cursor timeout during long Gemini calls
  const allBooks = await db.collection('books')
    .find(query, { projection: { id: 1, title: 1 } })
    .sort({ pages_count: -1 })
    .limit(limit || 0)
    .toArray();

  console.log(`Fetched ${allBooks.length} book IDs`);

  let processed = 0, succeeded = 0, failed = 0;

  // Process in chunks
  for (let i = 0; i < allBooks.length; i += concurrency) {
    const chunk = allBooks.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((book, j) => {
        const keyIndex = (i + j) % apiKeys.length;
        return scoreCollectionRelevanceRaw(db, book.id, apiKeys[keyIndex])
          .then(r => {
            if (r.success) {
              succeeded++;
              console.log(`✓ ${book.title?.slice(0, 50)} → ${r.primary} (${r.scores} collections${r.sacred ? ', ' + r.sacred : ''})`);
            } else {
              failed++;
              console.log(`✗ ${book.title?.slice(0, 50)}: ${r.error}`);
            }
          });
      })
    );
    processed += chunk.length;

    if (processed % 100 === 0 || processed === allBooks.length) {
      console.log(`--- Progress: ${processed}/${allBooks.length} (${succeeded} ok, ${failed} failed) ---`);
    }

    // Brief pause to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone: ${processed} processed, ${succeeded} succeeded, ${failed} failed`);

  // Update collection book_counts
  console.log('Updating collection book counts...');
  const collections = await db.collection('collections').find({}, { projection: { slug: 1 } }).toArray();
  for (const col of collections) {
    const count = await db.collection('books').countDocuments({ collections: col.slug });
    await db.collection('collections').updateOne({ _id: col._id }, { $set: { book_count: count } });
  }
  console.log('Collection counts updated.');

  client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
