/**
 * Book Deduplication System
 *
 * Provides cross-source duplicate detection at import time and
 * post-import batch scanning.
 *
 * Three-tier matching:
 *   1. Source fingerprint (exact: same source URL/identifier)
 *   2. Title+Author normalization (fuzzy: same work, different source)
 *   3. IIIF manifest URL match (exact: same digital object)
 */

import type { Db } from 'mongodb';

export interface DedupMatch {
  matchedBookId: string;
  matchedTitle: string;
  matchType: 'source_fingerprint' | 'title_author' | 'iiif_manifest';
  confidence: 'exact' | 'high' | 'medium';
}

export interface DedupResult {
  isDuplicate: boolean;
  matches: DedupMatch[];
}

/**
 * Normalize a title for fuzzy matching.
 * Strips punctuation, diacritics, common prefixes/suffixes, and lowercases.
 */
export function normalizeTitle(title: string): string {
  return title
    // Normalize unicode (decompose diacritics)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Lowercase
    .toLowerCase()
    // Strip leading articles
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|la|gli|i|el|los|las)\s+/i, '')
    // Strip common suffixes like volume numbers
    .replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i, '')
    // Strip punctuation except spaces
    .replace(/[^\w\s]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an author name for fuzzy matching.
 */
export function normalizeAuthor(author: string): string {
  const cleaned = author
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Strip honorifics and common suffixes
    .replace(/\b(dr|prof|rev|saint|st|sir|fr|bp)\b\.?\s*/g, '')
    // Strip life dates in parens: "Author (1500-1560)"
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    // Strip trailing comma + dates: "Author, 1500-1560"
    .replace(/,\s*[\d\s\-–?.]+$/, '')
    // Strip bracketed annotations: "[Meyer, Lodewijk]"
    .replace(/[\[\]]/g, '')
    // Strip "born YYYY" / "died YYYY" suffixes
    .replace(/\b(born|died|fl\.?|circa|ca?\.?)\s*\d{3,4}\b/g, '')
    // Strip punctuation
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Sort words alphabetically to handle "Last, First" vs "First Last"
  return cleaned.split(' ').filter(w => w.length > 0).sort().join(' ');
}

/**
 * Generate a source fingerprint for a book.
 * Returns null if no identifiable source info is available.
 */
export function sourceFingerprint(book: {
  ia_identifier?: string;
  gallica_ark?: string;
  bodleian_uuid?: string;
  mdz_id?: string;
  bsb_id?: string;
  google_books_id?: string;
  image_source?: {
    provider?: string;
    identifier?: string;
    iiif_manifest?: string;
    pdf_url?: string;
    source_url?: string;
  };
  dublin_core?: {
    dc_identifier?: string[];
  };
  [key: string]: unknown;
}): string | null {
  // Priority order: most specific identifiers first
  if (book.ia_identifier) return `ia:${book.ia_identifier}`;
  if (book.gallica_ark) return `gallica:${book.gallica_ark}`;
  if (book.bodleian_uuid) return `bodleian:${book.bodleian_uuid}`;
  if (book.mdz_id) return `mdz:${book.mdz_id}`;
  if (book.bsb_id) return `mdz:${book.bsb_id}`;
  if (book.google_books_id) return `gbooks:${book.google_books_id}`;

  // Fall back to image_source identifiers
  if (book.image_source?.identifier && book.image_source?.provider) {
    return `${book.image_source.provider}:${book.image_source.identifier}`;
  }

  // Fall back to IIIF manifest URL
  if (book.image_source?.iiif_manifest) {
    return `iiif:${book.image_source.iiif_manifest}`;
  }

  // Fall back to PDF URL
  if (book.image_source?.pdf_url) {
    return `pdf:${book.image_source.pdf_url}`;
  }

  // Fall back to dublin_core identifiers
  if (book.dublin_core?.dc_identifier?.length) {
    return `dc:${book.dublin_core.dc_identifier[0]}`;
  }

  return null;
}

/**
 * Check if a book is a duplicate before importing.
 *
 * Runs three tiers of matching:
 *   1. Source fingerprint — exact match on provider-specific IDs
 *   2. Title+Author — normalized fuzzy match
 *   3. IIIF manifest URL — exact match
 *
 * Returns all matches found (caller decides whether to block import).
 */
export async function checkDuplicate(
  db: Db,
  book: {
    title: string;
    author: string;
    display_title?: string;
    ia_identifier?: string;
    gallica_ark?: string;
    bodleian_uuid?: string;
    mdz_id?: string;
    bsb_id?: string;
    google_books_id?: string;
    image_source?: {
      provider?: string;
      identifier?: string;
      iiif_manifest?: string;
      pdf_url?: string;
      source_url?: string;
    };
    dublin_core?: {
      dc_identifier?: string[];
    };
  }
): Promise<DedupResult> {
  const matches: DedupMatch[] = [];

  // Tier 1: Source fingerprint match
  const fp = sourceFingerprint(book);
  if (fp) {
    const fpMatch = await db.collection('books').findOne(
      { source_fingerprint: fp, hidden: { $ne: true } },
      { projection: { id: 1, title: 1 } }
    );
    if (fpMatch) {
      matches.push({
        matchedBookId: fpMatch.id || fpMatch._id.toString(),
        matchedTitle: fpMatch.title,
        matchType: 'source_fingerprint',
        confidence: 'exact',
      });
    }
  }

  // Tier 2: Normalized title+author match
  const normTitle = normalizeTitle(book.title);
  const normAuthor = normalizeAuthor(book.author);

  if (normTitle.length >= 5) {
    // Use regex to find books with similar normalized titles
    // This is a fallback — the primary path uses the stored normalized fields
    const titleMatches = await db.collection('books').find(
      {
        normalized_title: normTitle,
        normalized_author: normAuthor,
        hidden: { $ne: true },
      },
      { projection: { id: 1, title: 1 } }
    ).limit(5).toArray();

    for (const tm of titleMatches) {
      // Don't double-count fingerprint matches
      if (!matches.some(m => m.matchedBookId === (tm.id || tm._id.toString()))) {
        matches.push({
          matchedBookId: tm.id || tm._id.toString(),
          matchedTitle: tm.title,
          matchType: 'title_author',
          confidence: 'high',
        });
      }
    }
  }

  // Tier 3: IIIF manifest URL match
  if (book.image_source?.iiif_manifest) {
    const iiifMatch = await db.collection('books').findOne(
      {
        'image_source.iiif_manifest': book.image_source.iiif_manifest,
        hidden: { $ne: true },
      },
      { projection: { id: 1, title: 1 } }
    );
    if (iiifMatch && !matches.some(m => m.matchedBookId === (iiifMatch.id || iiifMatch._id.toString()))) {
      matches.push({
        matchedBookId: iiifMatch.id || iiifMatch._id.toString(),
        matchedTitle: iiifMatch.title,
        matchType: 'iiif_manifest',
        confidence: 'exact',
      });
    }
  }

  return {
    isDuplicate: matches.length > 0,
    matches,
  };
}

/**
 * Backfill normalized fields and source fingerprints on all books.
 * Run once to populate, then maintained at import time.
 */
export async function backfillDedupFields(db: Db): Promise<{ updated: number; skipped: number }> {
  const cursor = db.collection('books').find(
    { $or: [
      { source_fingerprint: { $exists: false } },
      { normalized_title: { $exists: false } },
    ]},
    { projection: {
      id: 1, title: 1, author: 1, ia_identifier: 1, gallica_ark: 1,
      bodleian_uuid: 1, mdz_id: 1, bsb_id: 1, google_books_id: 1,
      image_source: 1, dublin_core: 1,
    }}
  );

  let updated = 0;
  let skipped = 0;
  const bulk = [];

  for await (const book of cursor) {
    const fp = sourceFingerprint(book);
    const normTitle = normalizeTitle(book.title || '');
    const normAuthor = normalizeAuthor(book.author || '');

    const update: Record<string, unknown> = {};
    if (normTitle) update.normalized_title = normTitle;
    if (normAuthor) update.normalized_author = normAuthor;
    if (fp) update.source_fingerprint = fp;

    if (Object.keys(update).length === 0) {
      skipped++;
      continue;
    }

    bulk.push({
      updateOne: {
        filter: { _id: book._id },
        update: { $set: update },
      },
    });

    if (bulk.length >= 500) {
      await db.collection('books').bulkWrite(bulk);
      updated += bulk.length;
      bulk.length = 0;
    }
  }

  if (bulk.length > 0) {
    await db.collection('books').bulkWrite(bulk);
    updated += bulk.length;
  }

  return { updated, skipped };
}

/**
 * Scan all visible books for duplicates and return groups.
 * Used for periodic auditing.
 */
export async function scanForDuplicates(db: Db): Promise<{
  fingerprintDupes: Array<{ fingerprint: string; count: number; bookIds: string[]; titles: string[] }>;
  titleAuthorDupes: Array<{ normalizedTitle: string; normalizedAuthor: string; count: number; bookIds: string[]; titles: string[] }>;
}> {
  // Find duplicate fingerprints
  const fpDupes = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true }, source_fingerprint: { $exists: true, $ne: null } } },
    { $group: {
      _id: '$source_fingerprint',
      count: { $sum: 1 },
      bookIds: { $push: '$id' },
      titles: { $push: '$title' },
    }},
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();

  // Find duplicate title+author combos
  const taDupes = await db.collection('books').aggregate([
    { $match: {
      hidden: { $ne: true },
      normalized_title: { $exists: true, $nin: [null, ''] },
      // Exclude generic titles
      title: { $nin: ['Unknown', 'Untitled'] },
    }},
    { $group: {
      _id: { t: '$normalized_title', a: '$normalized_author' },
      count: { $sum: 1 },
      bookIds: { $push: '$id' },
      titles: { $push: '$title' },
    }},
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();

  return {
    fingerprintDupes: fpDupes.map(d => ({
      fingerprint: d._id,
      count: d.count,
      bookIds: d.bookIds,
      titles: d.titles,
    })),
    titleAuthorDupes: taDupes.map(d => ({
      normalizedTitle: d._id.t,
      normalizedAuthor: d._id.a,
      count: d.count,
      bookIds: d.bookIds,
      titles: d.titles,
    })),
  };
}
