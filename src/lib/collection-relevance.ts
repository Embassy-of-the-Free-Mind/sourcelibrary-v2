/**
 * Collection relevance scoring — classifies a book into thematic collections
 * using Gemini AI based on title page OCR, index, and metadata.
 */
import { Db } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

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
  { slug: 'fables-folk-tales', name: 'Fables & Folk Tales', desc: 'Aesop, beast fables, fairy tales, oral tradition, folk narrative' },
  { slug: 'poetry', name: 'Poetry', desc: 'Lyric, epic, didactic, and occasional verse across traditions' },
  { slug: 'drama', name: 'Drama', desc: 'Tragedy, comedy, morality plays, theatrical texts' },
  { slug: 'prose-fiction', name: 'Prose Fiction', desc: 'Romances, novels, satire, utopias, picaresque, early fiction' },
  { slug: 'geography-exploration', name: 'Geography & Exploration', desc: 'Travel accounts, cosmography, cartography, voyages of discovery' },
  { slug: 'agriculture', name: 'Agriculture', desc: 'Farming, husbandry, viticulture, estate management, georgic literature' },
  { slug: 'mathematics', name: 'Mathematics & Sacred Number', desc: 'Arithmetic, geometry, astronomy, optics, mechanics, natural science' },
  { slug: 'music-harmony', name: 'Music, Harmony & Resonance', desc: 'Music theory, Pythagorean harmonics, acoustic science' },
  { slug: 'herbalism', name: 'Herbalism & Botany', desc: 'Herbals, materia medica, botanical illustration, plant taxonomy' },
  { slug: 'leonardo-da-vinci', name: 'Leonardo da Vinci', desc: 'Manuscripts, codices, treatises by Leonardo da Vinci' },
];

const TRADITIONS = [
  'christianity', 'judaism', 'islam', 'buddhism', 'hinduism', 'daoism',
  'zoroastrianism', 'gnostic-texts', 'manichaeism', 'mandaeanism',
  'jainism', 'confucianism', 'ancient-egyptian', 'orphism-mysteries',
  'norse-germanic', 'shinto', 'sikhism', 'indigenous-traditions',
  'druze', 'bahai', 'sumerian-mesopotamian', 'ancient-greek-religion',
  'celtic', 'tengrism', 'yazidi', 'polynesian', 'samaritan', 'cao-dai',
];

interface CollectionScore {
  relevance: number;
  role: 'primary' | 'secondary' | 'related';
  reasoning: string;
}

interface SacredTextType {
  tradition: string;
  type: 'scripture' | 'canonical_commentary' | 'liturgical' | 'devotional' | 'scholarly';
  confidence: 'high' | 'medium' | 'low';
}

interface ScoreResult {
  success: boolean;
  bookId: string;
  primary?: string;
  scoresCount?: number;
  sacred?: string | null;
  error?: string;
}

export async function scoreCollectionRelevance(
  db: Db,
  bookId: string,
  apiKey?: string,
): Promise<ScoreResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) return { success: false, bookId, error: 'No API key' };

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

  const titlePageText = titlePages.map(p => ((p.ocr as { data?: string })?.data || '').slice(0, 2000)).join('\n---\n');

  // Index/TOC
  let indexText = '';
  const chapters = book.chapters as Array<{ titleEn?: string; title?: string; pageNumber?: number }> | undefined;
  const indexEntries = (book.index as { entries?: Array<{ term: string }> })?.entries;
  if (chapters && chapters.length > 0) {
    indexText = chapters.map(ch => `${ch.titleEn || ch.title} (p.${ch.pageNumber})`).join('\n');
  } else if (indexEntries && indexEntries.length > 0) {
    indexText = indexEntries.slice(0, 50).map(e => e.term).join(', ');
  }

  const summary = (book.reading_summary as { overview?: string })?.overview || '';
  const illustrations = (book.gallery_image_count as number) || 0;

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
**Summary:** ${String(summary).slice(0, 500)}

## Title Page Text
${titlePageText || '[No OCR available]'}

## Table of Contents / Index
${(indexText || '').slice(0, 3000) || '[No index available]'}

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

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as {
      primary_collection: string;
      scores: Record<string, { relevance: number; role: string; reasoning: string }>;
      sacred_text_type: SacredTextType | null;
    };

    const scores: Record<string, CollectionScore> = {};
    for (const [slug, s] of Object.entries(parsed.scores || {})) {
      if (s.relevance >= 15) {
        let relevance = Math.min(100, Math.max(0, Math.round(s.relevance)));
        // Mechanical boosters
        if (illustrations > 10) relevance = Math.min(100, relevance + 3);
        if (illustrations > 50) relevance = Math.min(100, relevance + 5);
        if (slug === 'art-illustrated' && illustrations > 5) relevance = Math.min(100, relevance + 10);
        if (book.is_first_translation) relevance = Math.min(100, relevance + 5);
        if ((book.pages_count as number) > 100) relevance = Math.min(100, relevance + 2);
        if ((book.pages_count as number) > 300) relevance = Math.min(100, relevance + 3);

        scores[slug] = {
          relevance,
          role: s.role as CollectionScore['role'],
          reasoning: s.reasoning || '',
        };
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
          collection_scores_meta: { model: MODEL, scored_at: new Date() },
        },
      },
    );

    return {
      success: true,
      bookId,
      primary: parsed.primary_collection,
      scoresCount: Object.keys(scores).length,
      sacred: parsed.sacred_text_type?.type || null,
    };
  } catch (err) {
    return { success: false, bookId, error: err instanceof Error ? err.message : String(err) };
  }
}
