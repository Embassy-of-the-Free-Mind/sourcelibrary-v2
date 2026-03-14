/**
 * Processing priority scoring for books.
 *
 * Deterministic scoring (no AI calls) that decides which books to OCR and
 * translate first when scaling to 150K+ books. Computed at import time and
 * refreshable on demand.
 *
 * Dimensions (0-100 total):
 *   - Subject relevance (0-30): core EFM collections score highest
 *   - Language priority (0-25): Latin/German/French highest; English lowest
 *   - Scholarly signal (0-20): wikidata, read_count, is_first_translation
 *   - Efficiency (0-15): shorter books = faster ROI; sweet spot 50-500 pages
 *   - Scan quality (0-10): trusted providers, has thumbnail, has IIIF manifest
 *
 * Used by:
 *   - post-import-pipeline cron (sort order for each phase)
 *   - /api/books/[id]/processing-priority (manual trigger)
 *   - import routes (computed at import time)
 */

import { Db } from 'mongodb';

// ─── Subject Relevance (0-30) ─────────────────────────────────────────────

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
    return { score: 10, reasoning: 'No categories — default mid-low priority' };
  }

  const tier1Count = categories.filter(c => TIER1_SUBJECTS.has(c)).length;
  const tier2Count = categories.filter(c => TIER2_SUBJECTS.has(c)).length;
  const tier3Count = categories.filter(c => TIER3_SUBJECTS.has(c)).length;
  const lowCount = categories.filter(c => LOW_PRIORITY_SUBJECTS.has(c)).length;

  if (lowCount > 0 && tier1Count === 0 && tier2Count === 0) {
    return { score: 2, reasoning: `Out-of-scope subjects only` };
  }

  // Base: best tier match. Bonus: cross-category richness
  let score = 0;
  if (tier1Count > 0) score = 22 + Math.min(8, (tier1Count - 1) * 3 + tier2Count * 2);
  else if (tier2Count > 0) score = 15 + Math.min(10, (tier2Count - 1) * 3 + tier3Count * 2);
  else if (tier3Count > 0) score = 8 + Math.min(7, (tier3Count - 1) * 3);
  else score = 5; // Has categories but none in our taxonomy

  return {
    score: Math.min(30, score),
    reasoning: `T1:${tier1Count} T2:${tier2Count} T3:${tier3Count}`,
  };
}

// ─── Language Priority (0-25) ──────────────────────────────────────────────
// Books not yet in English are the point — translating them unlocks access.

const LANGUAGE_SCORES: Record<string, number> = {
  // High priority: major scholarly languages of the Renaissance
  'Latin': 25,
  'German': 23,
  'French': 21,
  'Italian': 20,
  'Spanish': 18,
  'Dutch': 17,
  'Portuguese': 15,
  // Medium: older/rarer languages
  'Greek': 22,
  'Hebrew': 22,
  'Arabic': 20,
  'Aramaic': 19,
  // Lower: already readable or very rare
  'English': 3, // Already readable — just OCR, skip translation
};

function scoreLanguagePriority(language: string): { score: number; reasoning: string } {
  if (!language) return { score: 12, reasoning: 'Unknown language — mid priority' };

  const normalized = language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
  const score = LANGUAGE_SCORES[normalized];

  if (score !== undefined) {
    return { score, reasoning: normalized };
  }

  // Unknown language — probably interesting (Syriac, Coptic, etc.)
  return { score: 16, reasoning: `${language} — unlisted, moderate priority` };
}

// ─── Scholarly Signal (0-20) ───────────────────────────────────────────────

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

  // Wikidata presence = notable work (0-6)
  if (book.wikidata_id) {
    const confidence = book.wikidata_match?.confidence;
    if (confidence === 'high') { score += 6; parts.push('wikidata:high'); }
    else if (confidence === 'medium') { score += 4; parts.push('wikidata:med'); }
    else { score += 3; parts.push('wikidata:sug'); }
  }

  // First English translation = unique contribution (0-5)
  if (book.is_first_translation) {
    score += 5;
    parts.push('first_translation');
  }

  // Reader engagement = proven demand (0-5)
  const reads = book.read_count || 0;
  if (reads > 0) {
    const readScore = Math.min(5, Math.round(Math.log10(reads + 1) * 2));
    score += readScore;
    parts.push(`reads:${reads}`);
  }

  // USTC catalog presence = bibliographically verified (0-2)
  if (book.ustc_id) {
    score += 2;
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
    score: Math.min(20, score),
    reasoning: parts.length > 0 ? parts.join(', ') : 'No scholarly signals',
  };
}

// ─── Efficiency (0-15) ─────────────────────────────────────────────────────
// Shorter books give faster ROI. Sweet spot: 50-500 pages.
// Very long books (1000+) still valuable but lower priority per-dollar.

function scoreEfficiency(pagesCount: number | undefined, pagesOcr: number | undefined, pagesTranslated: number | undefined): { score: number; reasoning: string } {
  const pages = pagesCount || 0;

  if (pages === 0) return { score: 5, reasoning: 'Unknown page count' };

  // Already fully translated — no processing needed, lowest priority
  const translated = pagesTranslated || 0;
  if (pages > 0 && translated >= pages) {
    return { score: 0, reasoning: 'Fully translated' };
  }

  // Already partially processed — boost to finish what we started
  const ocr = pagesOcr || 0;
  let partialBonus = 0;
  if (ocr > 0 && translated < pages) {
    // Has OCR but not fully translated — finishing is cheaper than starting new
    const ocrPct = ocr / pages;
    if (ocrPct > 0.5) partialBonus = 3;
    else if (ocrPct > 0) partialBonus = 1;
  }

  // Page count sweet spot: 50-500 pages
  let pageScore: number;
  if (pages < 10) pageScore = 3;        // Too short — might be fragments
  else if (pages < 50) pageScore = 8;   // Short — fast to process
  else if (pages <= 300) pageScore = 12; // Sweet spot
  else if (pages <= 500) pageScore = 10; // Good but longer
  else if (pages <= 1000) pageScore = 7; // Long — still worthwhile
  else pageScore = 4;                    // Very long — expensive

  return {
    score: Math.min(15, pageScore + partialBonus),
    reasoning: `${pages}p${partialBonus > 0 ? `, partial+${partialBonus}` : ''}`,
  };
}

// ─── Scan Quality (0-10) ───────────────────────────────────────────────────

const TRUSTED_PROVIDERS = new Set([
  'archive.org', 'mdz', 'gallica', 'bodleian', 'vatican',
  'cambridge', 'hab', 'e-rara', 'wellcome', 'loc',
]);

function scoreScanQuality(book: {
  image_source?: { provider?: string; iiif_manifest?: string };
  thumbnail?: string;
  thumbnail_blob?: string;
}): { score: number; reasoning: string } {
  let score = 0;
  const parts: string[] = [];

  // Trusted provider (0-4)
  const provider = book.image_source?.provider;
  if (provider && TRUSTED_PROVIDERS.has(provider)) {
    score += 4;
    parts.push(`provider:${provider}`);
  } else if (provider) {
    score += 2;
    parts.push(`provider:${provider}`);
  }

  // Has IIIF manifest (0-3) — images are reliably accessible
  if (book.image_source?.iiif_manifest) {
    score += 3;
    parts.push('iiif');
  }

  // Has thumbnail (0-2) — images are confirmed working
  if (book.thumbnail_blob) {
    score += 2;
    parts.push('blob_thumb');
  } else if (book.thumbnail) {
    score += 1;
    parts.push('thumb');
  }

  // Bonus for Vercel Blob thumbnail — images already CDN-cached
  if (book.thumbnail_blob) {
    score += 1;
  }

  return {
    score: Math.min(10, score),
    reasoning: parts.join(', ') || 'No source info',
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface ProcessingPriorityBreakdown {
  subject_relevance: { score: number; reasoning: string };
  language_priority: { score: number; reasoning: string };
  scholarly_signal: { score: number; reasoning: string };
  efficiency: { score: number; reasoning: string };
  scan_quality: { score: number; reasoning: string };
  scored_at: Date;
}

export interface ProcessingPriorityResult {
  score: number;
  breakdown: ProcessingPriorityBreakdown;
}

/**
 * Compute processing priority for a book. Pure function — no DB calls.
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
}): ProcessingPriorityResult {
  const subject = scoreSubjectRelevance(book.categories || []);
  const language = scoreLanguagePriority(book.language || '');
  const scholarly = scoreScholarlySignal(book);
  const efficiency = scoreEfficiency(book.pages_count, book.pages_ocr, book.pages_translated);
  const scan = scoreScanQuality(book);

  const score = Math.min(100,
    subject.score + language.score + scholarly.score + efficiency.score + scan.score
  );

  return {
    score,
    breakdown: {
      subject_relevance: subject,
      language_priority: language,
      scholarly_signal: scholarly,
      efficiency,
      scan_quality: scan,
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

  const result = computeProcessingPriority(book as Parameters<typeof computeProcessingPriority>[0]);

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
    const result = computeProcessingPriority(book as Parameters<typeof computeProcessingPriority>[0]);
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
