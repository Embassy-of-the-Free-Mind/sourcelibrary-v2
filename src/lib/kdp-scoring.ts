import { Db } from 'mongodb';

// ─── Types ───────────────────────────────────────────────────────────────

export interface KdpScoreBreakdown {
  quality: number;
  translation: number;
  efm_relevance: number;
  engagement: number;
  apparatus: number;
  first_translation_bonus: number;
  scored_at: Date;
}

export interface KdpMetadata {
  title: string;
  subtitle: string;
  author: string;
  description: string;
  keywords: string[];
  categories: string[];
  ai_disclosure: string;
  price: string;
}

export type KdpPublicationStatus = 'candidate' | 'review' | 'packaging' | 'ready' | 'uploaded' | 'live' | 'rejected';

export interface KdpQualityFlags {
  translation_percent: number;
  has_summary: boolean;
  has_index: boolean;
  has_chapters: boolean;
  has_cover: boolean;
  flagged_pages: number;
  low_quality: boolean;
  computed_at: Date;
}

export interface KdpPublication {
  id: string;
  book_id: string;
  edition_id?: string;
  status: KdpPublicationStatus;
  kdp_metadata: KdpMetadata;
  cover_image_url?: string;
  quality_flags?: KdpQualityFlags;
  asin?: string;
  kindle_url?: string;
  goodreads_url?: string;
  goodreads_imported_at?: Date;
  bundle_generated_at?: Date;
  bundle_url?: string;
  kdp_score_snapshot: number;
  created_at: Date;
  updated_at: Date;
  published_at?: Date;
  notes?: string;
}

// ─── EFM Collection Filter ──────────────────────────────────────────────
// Only books from these collections are KDP candidates (Western esoteric tradition)
export const EFM_COLLECTIONS = [
  'alchemy', 'astrology', 'hermetica', 'kabbalah', 'magic', 'mysticism',
  'natural-philosophy', 'renaissance-philosophy', 'secret-societies',
  'demonology', 'herbalism', 'medicine', 'classical-philosophy',
  'theology', 'literature', 'art-illustrated', 'leonardo-da-vinci',
  'music-harmony', 'sacred-texts', 'shwep',
];

// Books in these collections are excluded even if they overlap with EFM
export const EXCLUDED_COLLECTIONS = ['chinese-classics', 'indic-traditions'];

// ─── BISAC Category Mapping ──────────────────────────────────────────────

const BISAC_MAP: Record<string, string> = {
  'alchemy': 'OCC000000',
  'hermeticism': 'PHI019000',
  'kabbalah': 'REL040060',
  'astrology': 'OCC009000',
  'neoplatonism': 'PHI002000',
  'rosicrucianism': 'OCC000000',
  'natural-philosophy': 'SCI034000',
  'magic': 'OCC000000',
  'theurgy': 'PHI019000',
  'divination': 'OCC009000',
  'cosmology': 'SCI015000',
  'medicine': 'MED039000',
  'mathematics': 'MAT015000',
  'theology': 'REL067000',
  'philosophy': 'PHI000000',
  'occultism': 'OCC000000',
  'mysticism': 'REL047000',
};

// ─── Score Computation ───────────────────────────────────────────────────

export function computeKdpScore(
  book: {
    quality_score?: number;
    pages_translated?: number;
    pages_count?: number;
    pages_ocr?: number;
    read_count?: number;
    is_first_translation?: boolean;
    reading_summary?: unknown;
    index?: { generatedAt?: Date };
    chapters?: unknown[];
    thumbnail?: string;
    thumbnail_blob?: string;
  },
  entityCentrality: number,
  galleryImageCount: number,
): { score: number; breakdown: KdpScoreBreakdown } {
  // 1. Quality (0-30): scale quality_score from 0-100 to 0-30
  const quality = Math.round(((book.quality_score || 0) / 100) * 30);

  // 2. Translation completeness (0-25): below 40% = 0
  const pagesOcr = book.pages_ocr || 0;
  const pagesTranslated = book.pages_translated || 0;
  const translationPct = pagesOcr > 0 ? pagesTranslated / pagesOcr : 0;
  const translation = translationPct < 0.4 ? 0 : Math.round(translationPct * 25);

  // 3. EFM relevance (0-20): entity centrality (per-entity book_count capped at 10)
  // With capped centrality, p50≈500, p90≈2000 — divide by 100 for good 0-20 spread
  const efm_relevance = Math.min(20, Math.round(entityCentrality / 100));

  // 4. Engagement (0-10): log10(read_count + 1) * 4, capped
  const engagement = Math.min(10, Math.round(Math.log10((book.read_count || 0) + 1) * 4));

  // 5. Scholarly apparatus (0-10): +2 each for summary, index, chapters, cover, 5+ gallery images
  let apparatus = 0;
  if (book.reading_summary) apparatus += 2;
  if (book.index?.generatedAt) apparatus += 2;
  if (book.chapters && book.chapters.length > 0) apparatus += 2;
  if (book.thumbnail || book.thumbnail_blob) apparatus += 2;
  if (galleryImageCount >= 5) apparatus += 2;

  // 6. First translation bonus (0-5)
  const first_translation_bonus = book.is_first_translation ? 5 : 0;

  const score = quality + translation + efm_relevance + engagement + apparatus + first_translation_bonus;

  return {
    score: Math.min(100, score),
    breakdown: {
      quality,
      translation,
      efm_relevance,
      engagement,
      apparatus,
      first_translation_bonus,
      scored_at: new Date(),
    },
  };
}

// ─── Database Operations ─────────────────────────────────────────────────

/**
 * Score a single book and save to the book document.
 */
export async function scoreBookKdp(db: Db, bookId: string): Promise<{ score: number; breakdown: KdpScoreBreakdown } | null> {
  const book = await db.collection('books').findOne({ id: bookId }) as Record<string, unknown> | null;
  if (!book) return null;

  // Entity centrality: count entities referencing this book, cap each at 10
  // to prevent generic entities (e.g. "Egypt" at 611) from inflating scores
  const entities = await db.collection('entities').find(
    { 'books.book_id': bookId },
    { projection: { book_count: 1 } }
  ).toArray();
  const entityCentrality = entities.reduce((sum, e) => sum + Math.min(10, (e.book_count as number) || 0), 0);

  // Gallery image count
  const galleryImageCount = await db.collection('gallery_images').countDocuments({ book_id: bookId });

  const result = computeKdpScore(book as Parameters<typeof computeKdpScore>[0], entityCentrality, galleryImageCount);

  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { kdp_score: result.score, kdp_score_breakdown: result.breakdown } }
  );

  return result;
}

/**
 * Batch score all eligible books (pipeline complete, has translations).
 */
export async function scoreBooksKdp(
  db: Db,
  options?: { bookIds?: string[]; minTranslationPct?: number }
): Promise<{ scored: number; topBooks: Array<{ id: string; title: string; score: number }> }> {
  const filter: Record<string, unknown> = {};

  if (options?.bookIds?.length) {
    filter.id = { $in: options.bookIds };
  } else {
    // Default: pipeline complete EFM books with some translation
    filter['pipeline_auto.status'] = 'complete';
    filter.pages_translated = { $gt: 0 };
    filter.collections = { $in: EFM_COLLECTIONS, $nin: EXCLUDED_COLLECTIONS };
  }

  type BookDoc = Record<string, unknown> & { id: string; title: string; display_title?: string };
  const books = await db.collection('books').find(filter, {
    projection: {
      id: 1, title: 1, display_title: 1, quality_score: 1,
      pages_translated: 1, pages_count: 1, read_count: 1,
      is_first_translation: 1, reading_summary: 1, index: 1,
      chapters: 1, thumbnail: 1, thumbnail_blob: 1,
    }
  }).toArray() as unknown as BookDoc[];

  if (books.length === 0) return { scored: 0, topBooks: [] };

  // Batch entity centrality: one aggregation instead of N+1 queries
  // Cap each entity's book_count at 10 to prevent generic entities from inflating scores
  const bookIds = books.map(b => b.id);
  const centralityPipeline = [
    { $match: { 'books.book_id': { $in: bookIds } } },
    { $addFields: { capped_count: { $min: ['$book_count', 10] } } },
    { $unwind: '$books' },
    { $match: { 'books.book_id': { $in: bookIds } } },
    { $group: { _id: '$books.book_id', centrality: { $sum: '$capped_count' } } },
  ];
  const centralityResults = await db.collection('entities').aggregate(centralityPipeline).toArray();
  const centralityMap = new Map(centralityResults.map(r => [r._id, r.centrality || 0]));

  // Batch gallery image counts
  const galleryPipeline = [
    { $match: { book_id: { $in: bookIds } } },
    { $group: { _id: '$book_id', count: { $sum: 1 } } },
  ];
  const galleryResults = await db.collection('gallery_images').aggregate(galleryPipeline).toArray();
  const galleryMap = new Map(galleryResults.map(r => [r._id, r.count || 0]));

  // Score each book and build bulk writes
  const bulkOps = [];
  const scored: Array<{ id: string; title: string; score: number }> = [];

  for (const book of books) {
    const result = computeKdpScore(
      book as unknown as Parameters<typeof computeKdpScore>[0],
      centralityMap.get(book.id) || 0,
      galleryMap.get(book.id) || 0,
    );
    bulkOps.push({
      updateOne: {
        filter: { id: book.id },
        update: { $set: { kdp_score: result.score, kdp_score_breakdown: result.breakdown } },
      },
    });
    scored.push({ id: book.id, title: book.display_title || book.title, score: result.score });
  }

  if (bulkOps.length > 0) {
    await db.collection('books').bulkWrite(bulkOps);
  }

  // Sort by score descending and return top 10
  scored.sort((a, b) => b.score - a.score);

  return {
    scored: scored.length,
    topBooks: scored.slice(0, 10),
  };
}

// ─── Quality Flags ──────────────────────────────────────────────────────

/**
 * Compute quality flags for a KDP publication candidate.
 * Queries pages collection for translation coverage and flagged pages.
 */
export async function computeQualityFlags(
  db: Db,
  bookId: string,
  book: {
    quality_score?: number;
    pages_count?: number;
    reading_summary?: unknown;
    index?: { generatedAt?: Date };
    chapters?: unknown[];
    thumbnail?: string;
    thumbnail_blob?: string;
  },
): Promise<KdpQualityFlags> {
  const pagesCount = book.pages_count || 0;

  // Count translated pages and flagged (short translation) pages
  const [translatedCount, flaggedCount] = await Promise.all([
    db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $ne: '' },
    }),
    db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $ne: '' },
      $expr: { $lt: [{ $strLenCP: '$translation.data' }, 50] },
    }),
  ]);

  const translationPercent = pagesCount > 0
    ? Math.round((translatedCount / pagesCount) * 100)
    : 0;

  return {
    translation_percent: translationPercent,
    has_summary: !!book.reading_summary,
    has_index: !!book.index?.generatedAt,
    has_chapters: Array.isArray(book.chapters) && book.chapters.length > 0,
    has_cover: !!(book.thumbnail || book.thumbnail_blob),
    flagged_pages: flaggedCount,
    low_quality: (book.quality_score || 0) < 50,
    computed_at: new Date(),
  };
}

// ─── KDP Metadata Generation ────────────────────────────────────────────

export function generateKdpMetadata(book: {
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published?: string;
  categories?: string[];
  is_first_translation?: boolean;
  reading_summary?: { overview?: string };
  index?: {
    bookSummary?: { brief?: string };
    generatedAt?: Date;
  };
}): KdpMetadata {
  const displayTitle = book.display_title || book.title;
  const shortTitle = displayTitle.length > 60 ? displayTitle.slice(0, 57) + '...' : displayTitle;

  const title = `English Translation: ${displayTitle}`;

  const subtitle = book.is_first_translation
    ? `First English Translation of ${book.author}'s ${shortTitle} (${book.published || 'n.d.'})`
    : `AI-Assisted Translation from the Original ${book.language}`;

  const author = `${book.author} (trans. Source Library)`;

  // Description from reading summary, capped at 4000 chars
  let description = '';
  if (book.reading_summary?.overview) {
    description = book.reading_summary.overview;
  } else if (book.index?.bookSummary?.brief) {
    description = book.index.bookSummary.brief;
  }
  if (description.length > 4000) {
    description = description.slice(0, 3997) + '...';
  }

  // Keywords: category terms (max 7)
  const keywords = (book.categories || [])
    .map(c => c.replace(/-/g, ' '))
    .slice(0, 7);

  // BISAC categories
  const categories = (book.categories || [])
    .map(c => BISAC_MAP[c])
    .filter(Boolean);
  // Ensure at least one category
  if (categories.length === 0) {
    categories.push('OCC000000');
  }

  const ai_disclosure = `This translation was generated using AI (Google Gemini) from OCR of the original ${book.language} text.`;

  return {
    title,
    subtitle,
    author,
    description,
    keywords,
    categories: [...new Set(categories)],
    ai_disclosure,
    price: '$2.99',
  };
}
