/**
 * AI-powered collection relevance scoring.
 *
 * For each book, determines:
 * 1. Which collections it truly belongs to (not just mentions)
 * 2. A relevance score (0–100) per collection
 * 3. Whether it's a primary, secondary, or related member
 * 4. For sacred text traditions: scripture type classification
 *
 * Uses title page OCR + book index + metadata as input.
 * Follows the same patterns as quality-scoring.ts.
 *
 * Used by:
 * - scripts/maintenance/backfill-collection-relevance.mjs (batch)
 * - enrich-books cron (pipeline integration, future)
 */

import { Db, ObjectId } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { logGeminiCall } from './gemini-logger';

const MODEL = 'gemini-3-flash-preview';

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Top-level collections (not subcollections)
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

// Sacred text traditions (subcollections of sacred-texts)
const TRADITIONS = [
  { slug: 'christianity', name: 'Christianity' },
  { slug: 'judaism', name: 'Judaism' },
  { slug: 'islam', name: 'Islam' },
  { slug: 'buddhism', name: 'Buddhism' },
  { slug: 'hinduism', name: 'Hinduism' },
  { slug: 'daoism', name: 'Daoism' },
  { slug: 'zoroastrianism', name: 'Zoroastrianism' },
  { slug: 'hermetica-sacred', name: 'Hermetica & Gnostic Texts' },
  { slug: 'manichaeism', name: 'Manichaeism' },
  { slug: 'mandaeanism', name: 'Mandaeanism' },
  { slug: 'jainism', name: 'Jainism' },
  { slug: 'confucianism', name: 'Confucianism' },
  { slug: 'ancient-egyptian', name: 'Ancient Egyptian Religion' },
  { slug: 'orphism-mysteries', name: 'Orphism & Mystery Religions' },
  { slug: 'norse-germanic', name: 'Norse & Germanic' },
  { slug: 'shinto', name: 'Shinto' },
  { slug: 'sikhism', name: 'Sikhism' },
  { slug: 'indigenous-traditions', name: 'Indigenous Traditions' },
  { slug: 'druze', name: 'Druze' },
  { slug: 'bahai', name: 'Bahá\'í' },
  { slug: 'sumerian-mesopotamian', name: 'Sumerian & Mesopotamian' },
  { slug: 'ancient-greek-religion', name: 'Ancient Greek Religion' },
  { slug: 'celtic', name: 'Celtic' },
  { slug: 'tengrism', name: 'Tengrism & Turkic-Mongol' },
  { slug: 'yazidi', name: 'Yazidi' },
  { slug: 'polynesian', name: 'Polynesian & Pacific' },
  { slug: 'samaritan', name: 'Samaritan' },
  { slug: 'cao-dai', name: 'Cao Dai' },
];

export interface CollectionScore {
  relevance: number; // 0–100
  role: 'primary' | 'secondary' | 'related';
  reasoning: string;
}

export interface SacredTextClassification {
  tradition: string;
  type: 'scripture' | 'canonical_commentary' | 'liturgical' | 'devotional' | 'scholarly';
  confidence: 'high' | 'medium' | 'low';
}

export interface RelevanceResult {
  collection_scores: Record<string, CollectionScore>;
  sacred_text_type?: SacredTextClassification;
  primary_collection: string;
  model: string;
  scored_at: Date;
}

export interface RelevanceOutcome {
  success: boolean;
  bookId: string;
  result?: RelevanceResult;
  error?: string;
}

/**
 * Gather input text for classification: title page + index/TOC + metadata
 */
async function gatherBookContext(db: Db, bookId: string): Promise<{
  titlePageText: string;
  indexText: string;
  metadata: Record<string, unknown>;
} | null> {
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { _id: new ObjectId(bookId) }] },
    {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        is_first_translation: 1, collections: 1, categories: 1,
        reading_summary: 1, index: 1, chapters: 1,
        gallery_image_count: 1,
      },
    },
  );
  if (!book) return null;

  // Get title page (first 3 pages of OCR — title page is usually page 1-3)
  const titlePages = await db.collection('pages')
    .find(
      { book_id: book.id || bookId, 'ocr.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'ocr.data': 1 } },
    )
    .sort({ page_number: 1 })
    .limit(3)
    .toArray();

  const titlePageText = titlePages
    .map(p => (p.ocr?.data || '').slice(0, 2000))
    .join('\n---\n');

  // Get index/TOC: use chapters if available, otherwise book index entries
  let indexText = '';
  if (book.chapters?.length > 0) {
    indexText = book.chapters
      .map((ch: { titleEn?: string; title?: string; pageNumber?: number }) =>
        `${ch.titleEn || ch.title} (p.${ch.pageNumber})`
      )
      .join('\n');
  } else if (book.index?.entries?.length > 0) {
    indexText = book.index.entries
      .slice(0, 50)
      .map((e: { term: string; pages?: number[] }) => e.term)
      .join(', ');
  }

  // Reading summary as additional context
  const summary = book.reading_summary?.overview || '';

  return {
    titlePageText,
    indexText: indexText.slice(0, 3000),
    metadata: {
      title: book.display_title || book.title,
      author: book.author,
      language: book.language,
      year: book.published,
      pages: book.pages_count,
      illustrations: book.gallery_image_count || 0,
      is_first_translation: book.is_first_translation || false,
      current_collections: book.collections || [],
      summary: summary.slice(0, 500),
    },
  };
}

function buildPrompt(
  titlePageText: string,
  indexText: string,
  metadata: Record<string, unknown>,
): string {
  const collectionList = COLLECTIONS
    .map(c => `- ${c.slug}: ${c.name} — ${c.desc}`)
    .join('\n');

  const traditionList = TRADITIONS
    .map(t => `- ${t.slug}: ${t.name}`)
    .join('\n');

  return `You are a librarian classifying a historical book into thematic collections.

## Book Information

**Title:** ${metadata.title}
**Author:** ${metadata.author || 'Unknown'}
**Language:** ${metadata.language || 'Unknown'}
**Year:** ${metadata.year || 'Unknown'}
**Pages:** ${metadata.pages || 'Unknown'}
**Illustrations:** ${metadata.illustrations || 0}
**Summary:** ${metadata.summary || 'N/A'}

## Title Page Text
${titlePageText || '[No OCR available]'}

## Table of Contents / Index
${indexText || '[No index available]'}

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
- Only include collections where relevance >= 15. Omit irrelevant collections entirely.
- Exactly ONE collection should have role "primary" — this is what the book IS about.
- "secondary" = the book substantially engages with this topic (relevance 40-70).
- "related" = the book touches on this topic but isn't about it (relevance 15-39).
- A score of 80+ means this book is a landmark text for that collection.
- For sacred_text_type: only set this if the book is genuinely a scripture, prayer book, or canonical commentary — not scholarship ABOUT a religion.
- "scripture" = a foundational holy text (Bible, Quran, Vedas, Avesta, etc.)
- "canonical_commentary" = authoritative traditional commentary (Church Fathers, Talmud, etc.)
- "liturgical" = prayer books, hymnals, ritual texts used in worship
- "devotional" = popular devotional literature (not scripture but widely used in practice)
- "scholarly" = academic study of a religion — does NOT belong on the Sacred Texts portal

Respond ONLY with valid JSON, no markdown fences.`;
}

/**
 * Score a single book's collection relevance.
 */
export async function scoreCollectionRelevance(
  db: Db,
  bookId: string,
  apiKey?: string,
): Promise<RelevanceOutcome> {
  const context = await gatherBookContext(db, bookId);
  if (!context) {
    return { success: false, bookId, error: 'Book not found' };
  }

  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return { success: false, bookId, error: 'No GEMINI_API_KEY' };
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt(context.titlePageText, context.indexText, context.metadata);

  const startMs = Date.now();
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const durationMs = Date.now() - startMs;

    // Log the Gemini call
    await logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: MODEL,
      book_id: bookId,
      input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
      output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      duration_ms: durationMs,
      status: 'success',
    }).catch(() => {});

    const parsed = JSON.parse(text);

    // Build collection_scores
    const collectionScores: Record<string, CollectionScore> = {};
    for (const [slug, score] of Object.entries(parsed.scores || {})) {
      const s = score as { relevance: number; role: string; reasoning: string };
      if (s.relevance >= 15) {
        collectionScores[slug] = {
          relevance: Math.min(100, Math.max(0, Math.round(s.relevance))),
          role: (['primary', 'secondary', 'related'].includes(s.role) ? s.role : 'related') as CollectionScore['role'],
          reasoning: s.reasoning || '',
        };
      }
    }

    // Apply mechanical boosters
    const illustrations = (context.metadata.illustrations as number) || 0;
    const isFirstTranslation = context.metadata.is_first_translation as boolean;
    const pages = (context.metadata.pages as number) || 0;

    for (const slug of Object.keys(collectionScores)) {
      let boost = 0;
      // Illustration boost (especially for art-illustrated)
      if (illustrations > 10) boost += 3;
      if (illustrations > 50) boost += 5;
      if (slug === 'art-illustrated' && illustrations > 5) boost += 10;
      // First translation boost
      if (isFirstTranslation) boost += 5;
      // Substantial work boost
      if (pages > 100) boost += 2;
      if (pages > 300) boost += 3;

      collectionScores[slug].relevance = Math.min(100, collectionScores[slug].relevance + boost);
    }

    const relevanceResult: RelevanceResult = {
      collection_scores: collectionScores,
      primary_collection: parsed.primary_collection || '',
      model: MODEL,
      scored_at: new Date(),
    };

    if (parsed.sacred_text_type) {
      relevanceResult.sacred_text_type = parsed.sacred_text_type;
    }

    // Write to database
    const updateCollections = Object.entries(collectionScores)
      .filter(([, s]) => s.role === 'primary' || s.role === 'secondary')
      .map(([slug]) => slug);

    await db.collection('books').updateOne(
      { $or: [{ id: bookId }, { _id: new ObjectId(bookId) }] },
      {
        $set: {
          collection_scores: collectionScores,
          collection_primary: parsed.primary_collection,
          sacred_text_type: parsed.sacred_text_type || null,
          collections: updateCollections,
          'collection_scores_meta.model': MODEL,
          'collection_scores_meta.scored_at': new Date(),
        },
      },
    );

    return { success: true, bookId, result: relevanceResult };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, bookId, error };
  }
}
