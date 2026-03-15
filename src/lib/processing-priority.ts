/**
 * Processing priority scoring for books.
 *
 * Deterministic scoring (no AI calls) that decides which books to OCR and
 * translate first when scaling to 150K+ books. Computed at import time and
 * refreshable on demand.
 *
 * Dimensions (0-100 total):
 *   - Subject relevance (0-25): core EFM collections score highest
 *   - Language priority (0-20): Latin far ahead; German/Greek next; English near zero
 *   - Scan quality (0-20): trusted providers, IIIF manifest, working images — critical
 *   - Scholarly signal (0-15): wikidata, read_count, is_first_translation
 *   - Illustrations (0-10): books with images (woodcuts, diagrams, emblems) are treasures
 *   - Efficiency (0-10): shorter books = faster ROI; sweet spot 50-500 pages
 *
 * Used by:
 *   - post-import-pipeline cron (sort order for each phase)
 *   - /api/books/[id]/processing-priority (manual trigger)
 *   - import routes (computed at import time)
 */

import { Db } from 'mongodb';

// ─── Subject Relevance (0-25) ─────────────────────────────────────────────

// Tier 1: Core Western esotericism — the mission
const TIER1_SUBJECTS = new Set([
  'alchemy', 'hermetica', 'kabbalah', 'magic', 'natural-philosophy',
  'renaissance-philosophy', 'rosicrucianism',
]);

// Tier 2: Adjacent traditions — high value
const TIER2_SUBJECTS = new Set([
  'astrology', 'mysticism', 'secret-societies', 'demonology',
  'classical-philosophy', 'sacred-texts', 'shwep',
]);

// Tier 3: Supporting disciplines — moderate value
const TIER3_SUBJECTS = new Set([
  'herbalism', 'medicine', 'theology', 'literature',
  'art-illustrated', 'music-harmony', 'leonardo-da-vinci',
]);

// Penalty: out-of-scope subjects
const LOW_PRIORITY_SUBJECTS = new Set([
  'chinese-classics', 'indic-traditions',
]);

function scoreSubjectRelevance(categories: string[]): { score: number; reasoning: string } {
  if (!categories || categories.length === 0) {
    return { score: 8, reasoning: 'No categories — default mid-low priority' };
  }

  const tier1Count = categories.filter(c => TIER1_SUBJECTS.has(c)).length;
  const tier2Count = categories.filter(c => TIER2_SUBJECTS.has(c)).length;
  const tier3Count = categories.filter(c => TIER3_SUBJECTS.has(c)).length;
  const lowCount = categories.filter(c => LOW_PRIORITY_SUBJECTS.has(c)).length;

  if (lowCount > 0 && tier1Count === 0 && tier2Count === 0) {
    return { score: 2, reasoning: 'Out-of-scope subjects only' };
  }

  // Base: best tier match. Bonus: cross-category richness
  let score = 0;
  if (tier1Count > 0) score = 18 + Math.min(7, (tier1Count - 1) * 3 + tier2Count * 2);
  else if (tier2Count > 0) score = 12 + Math.min(8, (tier2Count - 1) * 3 + tier3Count * 2);
  else if (tier3Count > 0) score = 6 + Math.min(6, (tier3Count - 1) * 3);
  else score = 4; // Has categories but none in our taxonomy

  return {
    score: Math.min(25, score),
    reasoning: `T1:${tier1Count} T2:${tier2Count} T3:${tier3Count}`,
  };
}

// ─── Language Priority (0-20) ──────────────────────────────────────────────
// Latin is THE language of the Renaissance scholarly tradition — clear #1.
// German is important but much more has already been translated.

const LANGUAGE_SCORES: Record<string, number> = {
  // Latin: undisputed top priority — lingua franca of Renaissance scholarship
  'Latin': 20,
  // Classical/sacred languages — extremely valuable, rarely translated
  'Greek': 17,
  'Hebrew': 17,
  'Arabic': 16,
  'Aramaic': 15,
  // Major vernaculars — important but more accessible
  'German': 14,
  'French': 13,
  'Italian': 12,
  'Spanish': 11,
  'Dutch': 10,
  'Portuguese': 9,
  // Already readable — just OCR, skip translation
  'English': 2,
};

function scoreLanguagePriority(language: string): { score: number; reasoning: string } {
  if (!language) return { score: 10, reasoning: 'Unknown language — mid priority' };

  const normalized = language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
  const score = LANGUAGE_SCORES[normalized];

  if (score !== undefined) {
    return { score, reasoning: normalized };
  }

  // Unknown language — probably interesting (Syriac, Coptic, etc.)
  return { score: 12, reasoning: `${language} — unlisted, moderate priority` };
}

// ─── Scan Quality (0-20) ───────────────────────────────────────────────────
// Critical dimension — bad scans waste OCR budget and produce garbage.
// Trusted providers with IIIF manifests and confirmed-working images score high.

const TRUSTED_PROVIDERS = new Set([
  'archive.org', 'mdz', 'gallica', 'bodleian', 'vatican',
  'cambridge', 'hab', 'e-rara', 'wellcome', 'loc',
]);

// Premium providers: consistently excellent digitization quality
const PREMIUM_PROVIDERS = new Set([
  'bodleian', 'vatican', 'cambridge', 'hab', 'e-rara', 'gallica',
]);

function scoreScanQuality(book: {
  image_source?: { provider?: string; iiif_manifest?: string };
  thumbnail?: string;
  thumbnail_blob?: string;
}): { score: number; reasoning: string } {
  let score = 0;
  const parts: string[] = [];

  const provider = book.image_source?.provider;

  // Provider trust tier (0-8)
  if (provider && PREMIUM_PROVIDERS.has(provider)) {
    score += 8;
    parts.push(`premium:${provider}`);
  } else if (provider && TRUSTED_PROVIDERS.has(provider)) {
    score += 6;
    parts.push(`trusted:${provider}`);
  } else if (provider) {
    score += 3;
    parts.push(`provider:${provider}`);
  }

  // Has IIIF manifest (0-5) — images are reliably accessible and interoperable
  if (book.image_source?.iiif_manifest) {
    score += 5;
    parts.push('iiif');
  }

  // Working images confirmed (0-5)
  if (book.thumbnail_blob) {
    score += 5; // CDN-cached, verified working
    parts.push('blob_thumb');
  } else if (book.thumbnail) {
    score += 2; // Has URL but not verified/cached
    parts.push('thumb');
  }

  // No provider at all — risky
  if (!provider && !book.image_source?.iiif_manifest) {
    score = 1;
    parts.length = 0;
    parts.push('no_source_info');
  }

  return {
    score: Math.min(20, score),
    reasoning: parts.join(', ') || 'No source info',
  };
}

// ─── Scholarly Signal (0-15) ───────────────────────────────────────────────

function scoreScholarlySignal(book: {
  wikidata_id?: string;
  wikidata_match?: { confidence?: string };
  read_count?: number;
  is_first_translation?: boolean;
  quality_score?: number;
  ustc_id?: string;
}): { score: number; reasoning: string } {
  let score = 0;
  const parts: string[] = [];

  // Wikidata presence = notable work (0-5)
  if (book.wikidata_id) {
    const confidence = book.wikidata_match?.confidence;
    if (confidence === 'high') { score += 5; parts.push('wikidata:high'); }
    else if (confidence === 'medium') { score += 3; parts.push('wikidata:med'); }
    else { score += 2; parts.push('wikidata:sug'); }
  }

  // First English translation = unique contribution (0-4)
  if (book.is_first_translation) {
    score += 4;
    parts.push('first_translation');
  }

  // Reader engagement = proven demand (0-3)
  const reads = book.read_count || 0;
  if (reads > 0) {
    const readScore = Math.min(3, Math.round(Math.log10(reads + 1) * 1.5));
    score += readScore;
    parts.push(`reads:${reads}`);
  }

  // USTC catalog presence = bibliographically verified (0-1)
  if (book.ustc_id) {
    score += 1;
    parts.push('ustc');
  }

  // Quality score as tiebreaker (0-2)
  if (book.quality_score && book.quality_score >= 70) {
    score += 2;
    parts.push(`quality:${book.quality_score}`);
  } else if (book.quality_score && book.quality_score >= 50) {
    score += 1;
  }

  return {
    score: Math.min(15, score),
    reasoning: parts.length > 0 ? parts.join(', ') : 'No scholarly signals',
  };
}

// ─── Illustrations (0-10) ──────────────────────────────────────────────────
// Books with woodcuts, emblems, diagrams, and engravings are treasures.
// They're visually compelling and often unique to the period.

function scoreIllustrations(book: {
  categories?: string[];
  gallery_image_count?: number;
}): { score: number; reasoning: string } {
  let score = 0;
  const parts: string[] = [];

  const imageCount = book.gallery_image_count || 0;

  // Gallery images detected (0-8)
  if (imageCount >= 20) { score += 8; parts.push(`${imageCount} images`); }
  else if (imageCount >= 10) { score += 6; parts.push(`${imageCount} images`); }
  else if (imageCount >= 5) { score += 4; parts.push(`${imageCount} images`); }
  else if (imageCount >= 1) { score += 2; parts.push(`${imageCount} images`); }

  // Art-illustrated category = likely to have significant imagery (0-2)
  const cats = book.categories || [];
  if (cats.includes('art-illustrated') || cats.includes('leonardo-da-vinci')) {
    score += 2;
    parts.push('art_category');
  }

  return {
    score: Math.min(10, score),
    reasoning: parts.length > 0 ? parts.join(', ') : 'No illustrations detected',
  };
}

// ─── Efficiency (0-10) ─────────────────────────────────────────────────────
// Shorter books give faster ROI. Sweet spot: 50-500 pages.
// Very long books (1000+) still valuable but lower priority per-dollar.

function scoreEfficiency(pagesCount: number | undefined, pagesOcr: number | undefined, pagesTranslated: number | undefined): { score: number; reasoning: string } {
  const pages = pagesCount || 0;

  if (pages === 0) return { score: 3, reasoning: 'Unknown page count' };

  // Already fully translated — no processing needed, lowest priority
  const translated = pagesTranslated || 0;
  if (pages > 0 && translated >= pages) {
    return { score: 0, reasoning: 'Fully translated' };
  }

  // Already partially processed — boost to finish what we started
  const ocr = pagesOcr || 0;
  let partialBonus = 0;
  if (ocr > 0 && translated < pages) {
    const ocrPct = ocr / pages;
    if (ocrPct > 0.5) partialBonus = 2;
    else if (ocrPct > 0) partialBonus = 1;
  }

  // Page count sweet spot
  let pageScore: number;
  if (pages < 10) pageScore = 2;        // Too short — might be fragments
  else if (pages < 50) pageScore = 5;   // Short — fast to process
  else if (pages <= 300) pageScore = 8; // Sweet spot
  else if (pages <= 500) pageScore = 7; // Good but longer
  else if (pages <= 1000) pageScore = 5; // Long — still worthwhile
  else pageScore = 3;                    // Very long — expensive

  return {
    score: Math.min(10, pageScore + partialBonus),
    reasoning: `${pages}p${partialBonus > 0 ? `, partial+${partialBonus}` : ''}`,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface ProcessingPriorityBreakdown {
  subject_relevance: { score: number; reasoning: string };
  language_priority: { score: number; reasoning: string };
  scan_quality: { score: number; reasoning: string };
  scholarly_signal: { score: number; reasoning: string };
  illustrations: { score: number; reasoning: string };
  efficiency: { score: number; reasoning: string };
  scored_at: Date;
}

export interface ProcessingPriorityResult {
  score: number;
  breakdown: ProcessingPriorityBreakdown;
}

/**
 * Compute processing priority for a book. Pure function — no DB calls.
 * gallery_image_count must be provided separately (from gallery_images collection).
 */
export function computeProcessingPriority(book: {
  categories?: string[];
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  wikidata_id?: string;
  wikidata_match?: { confidence?: string };
  read_count?: number;
  is_first_translation?: boolean;
  quality_score?: number;
  ustc_id?: string;
  image_source?: { provider?: string; iiif_manifest?: string };
  thumbnail?: string;
  thumbnail_blob?: string;
  gallery_image_count?: number;
}): ProcessingPriorityResult {
  const subject = scoreSubjectRelevance(book.categories || []);
  const language = scoreLanguagePriority(book.language || '');
  const scan = scoreScanQuality(book);
  const scholarly = scoreScholarlySignal(book);
  const illustrations = scoreIllustrations(book);
  const efficiency = scoreEfficiency(book.pages_count, book.pages_ocr, book.pages_translated);

  const score = Math.min(100,
    subject.score + language.score + scan.score + scholarly.score + illustrations.score + efficiency.score
  );

  return {
    score,
    breakdown: {
      subject_relevance: subject,
      language_priority: language,
      scan_quality: scan,
      scholarly_signal: scholarly,
      illustrations,
      efficiency,
      scored_at: new Date(),
    },
  };
}

// ─── Database Operations ─────────────────────────────────────────────────

/**
 * Score a single book and save to the book document.
 */
export async function scoreBookPriority(
  db: Db,
  bookId: string,
): Promise<ProcessingPriorityResult | null> {
  const book = await db.collection('books').findOne(
    { id: bookId },
    {
      projection: {
        categories: 1, language: 1, pages_count: 1, pages_ocr: 1,
        pages_translated: 1, wikidata_id: 1, wikidata_match: 1,
        read_count: 1, is_first_translation: 1, quality_score: 1,
        ustc_id: 1, image_source: 1, thumbnail: 1, thumbnail_blob: 1,
      },
    },
  );
  if (!book) return null;

  // Get gallery image count
  const galleryImageCount = await db.collection('gallery_images')
    .countDocuments({ book_id: bookId });

  const input = { ...book, gallery_image_count: galleryImageCount } as Parameters<typeof computeProcessingPriority>[0];
  const result = computeProcessingPriority(input);

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        processing_priority: result.score,
        processing_priority_breakdown: result.breakdown,
      },
    },
  );

  return result;
}

/**
 * Batch score all books (or a subset). Efficient: single query + bulkWrite.
 */
export async function scoreBooksProcessingPriority(
  db: Db,
  options?: { bookIds?: string[]; limit?: number },
): Promise<{ scored: number; distribution: Record<string, number> }> {
  const filter: Record<string, unknown> = {};

  if (options?.bookIds?.length) {
    filter.id = { $in: options.bookIds };
  }

  const projection = {
    id: 1, categories: 1, language: 1, pages_count: 1, pages_ocr: 1,
    pages_translated: 1, wikidata_id: 1, wikidata_match: 1,
    read_count: 1, is_first_translation: 1, quality_score: 1,
    ustc_id: 1, image_source: 1, thumbnail: 1, thumbnail_blob: 1,
  };

  // Batch gallery image counts
  const bookIds = options?.bookIds;
  const galleryFilter = bookIds?.length ? { book_id: { $in: bookIds } } : {};
  const galleryResults = await db.collection('gallery_images').aggregate([
    { $match: galleryFilter },
    { $group: { _id: '$book_id', count: { $sum: 1 } } },
  ]).toArray();
  const galleryMap = new Map(galleryResults.map(r => [r._id as string, r.count as number]));

  const cursor = db.collection('books').find(filter, { projection });
  if (options?.limit) cursor.limit(options.limit);

  const bulkOps: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  const distribution: Record<string, number> = {
    '90-100': 0, '70-89': 0, '50-69': 0, '30-49': 0, '0-29': 0,
  };

  let count = 0;
  for await (const book of cursor) {
    const input = {
      ...book,
      gallery_image_count: galleryMap.get(book.id as string) || 0,
    } as Parameters<typeof computeProcessingPriority>[0];
    const result = computeProcessingPriority(input);
    bulkOps.push({
      updateOne: {
        filter: { id: book.id },
        update: {
          $set: {
            processing_priority: result.score,
            processing_priority_breakdown: result.breakdown,
          },
        },
      },
    });

    // Track distribution
    if (result.score >= 90) distribution['90-100']++;
    else if (result.score >= 70) distribution['70-89']++;
    else if (result.score >= 50) distribution['50-69']++;
    else if (result.score >= 30) distribution['30-49']++;
    else distribution['0-29']++;

    count++;

    // Flush in batches of 500
    if (bulkOps.length >= 500) {
      await db.collection('books').bulkWrite(bulkOps);
      bulkOps.length = 0;
    }
  }

  // Flush remaining
  if (bulkOps.length > 0) {
    await db.collection('books').bulkWrite(bulkOps);
  }

  return { scored: count, distribution };
}
