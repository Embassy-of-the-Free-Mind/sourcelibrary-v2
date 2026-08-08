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
  /** Whether the already-existing match is public. Hidden matches still count as
   * duplicates — this lets callers/auditors distinguish a live dup from a backlog one. */
  matchedVisible?: boolean;
  /** Which collection the match was found in: 'books' (live) or 'books_warehouse'
   * (acquired+archived, awaiting promotion). Both count as duplicates. */
  matchedCollection?: 'books' | 'books_warehouse';
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
 * Latin ordinals and roman numerals used to mark volumes ("Tomus primus",
 * "Tom. II"). Kept small and explicit — we only resolve them when a volume
 * KEYWORD precedes them, so false positives are unlikely.
 */
const LATIN_ORDINALS: Record<string, number> = {
  primus: 1, prima: 1, secundus: 2, secunda: 2, tertius: 3, tertia: 3,
  quartus: 4, quarta: 4, quintus: 5, quinta: 5, sextus: 6, septimus: 7,
  octavus: 8, nonus: 9, decimus: 10,
};

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    if (cur == null) return null;
    total += next != null && cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

/**
 * Extract a volume/part number from a raw title, when one is explicitly marked.
 * Returns null if no marker is present (callers then fall back to other
 * discriminators). `normalizeTitle()` STRIPS these markers, so vol. 1 and vol. 2
 * of the same set collapse to the same `normalized_title` — extracting the
 * volume from the raw title is how we tell two volumes of one work apart.
 * Handles arabic ("Vol. 2", "(Vol 2)", "Tome 3"), roman ("Tomus II"), and
 * common Latin ordinals ("Tomus primus").
 */
export function extractVolume(title?: string | null): number | null {
  if (!title) return null;
  const t = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const KW = '(?:vol(?:ume)?|tom(?:us|o|e)?|band|part|pt|liber|deel|teil)\\.?\\s*\\(?\\s*';
  // keyword + arabic number
  let m = t.match(new RegExp(`\\b${KW}(\\d{1,3})\\b`));
  if (m) return parseInt(m[1], 10);
  // keyword + Latin ordinal word
  m = t.match(new RegExp(`\\b${KW}(${Object.keys(LATIN_ORDINALS).join('|')})\\b`));
  if (m) return LATIN_ORDINALS[m[1]] ?? null;
  // keyword + roman numeral (whole token must be roman letters)
  m = t.match(new RegExp(`\\b${KW}([ivxlcdm]{1,6})\\b`));
  if (m) return romanToInt(m[1]);
  return null;
}

/**
 * Best-effort publication year for edition comparison. Prefers a numeric
 * `year`, else parses the first 3–4 digit run out of `published`.
 *
 * Negative years are BCE and are returned as-is. They used to be rejected by a
 * `> 0` guard, which then fell through to digit-scraping `published` — and for
 * an ancient object that string is prose, so "Ur III / Old Babylonian
 * (c. 2100–1600 BCE)" scraped to the year 2100 CE. Trusting the numeric field
 * is strictly more correct for the ~600 live books dated BCE.
 */
export function editionYear(book: { year?: number | null; published?: string | null }): number | null {
  if (typeof book.year === 'number' && Number.isFinite(book.year) && book.year !== 0) return book.year;
  if (book.published) {
    const m = String(book.published).match(/\b(\d{3,4})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
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
    /** Edition discriminators — two records that share a normalized title+author
     * but differ in publication year (or volume, parsed from the title) are
     * distinct editions, NOT duplicates. Pass these so Tier 2 can tell them apart. */
    year?: number;
    published?: string;
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

  // NOTE: dedup does NOT filter on `visible`. A duplicate is a duplicate whether
  // or not the existing copy is public — and imports land hidden, so a
  // visible-only check is blind to the entire hidden backlog (the regime we now
  // import into at volume). We surface the match's visibility instead of hiding it.
  const VIS_PROJ = { id: 1, title: 1, display_title: 1, year: 1, published: 1, visible: 1, hidden: 1 };

  // Check BOTH the live library and the warehouse. `books_warehouse` holds books
  // we've already acquired + archived that are awaiting promotion to `books`
  // (pipeline Phase 1.95). A duplicate there is still a duplicate — skipping the
  // warehouse re-acquires ~items we already hold. (issue: warehouse dedup gap)
  const COLLECTIONS: Array<'books' | 'books_warehouse'> = ['books', 'books_warehouse'];
  const seen = (id: string) => matches.some(m => m.matchedBookId === id);

  // Tier 1: Source fingerprint match (exact)
  const fp = sourceFingerprint(book);
  if (fp) {
    for (const cn of COLLECTIONS) {
      const fpMatch = await db.collection(cn).findOne(
        { source_fingerprint: fp },
        { projection: VIS_PROJ }
      );
      if (fpMatch) {
        const id = fpMatch.id || fpMatch._id.toString();
        if (!seen(id)) matches.push({
          matchedBookId: id,
          matchedTitle: fpMatch.title,
          matchType: 'source_fingerprint',
          confidence: 'exact',
          matchedVisible: fpMatch.visible === true,
          matchedCollection: cn,
        });
      }
    }
  }

  // Tier 2: Normalized title+author match (high)
  //
  // Holding multiple EDITIONS of one work is a first-class case here (the
  // work_id / original_edition_id / text_role layers exist for exactly this).
  // A normalized title+author collision is therefore only a duplicate when the
  // candidate and the match are the SAME edition. Two records that differ in
  // publication year — or in volume, which normalizeTitle() strips out — are
  // distinct editions and must be allowed through. (Tiers 1 and 3 still
  // hard-block a true same-item re-import regardless of year.)
  const normTitle = normalizeTitle(book.title);
  const normAuthor = normalizeAuthor(book.author);
  const candYear = editionYear(book);
  const candVol = extractVolume(book.display_title) ?? extractVolume(book.title);

  if (normTitle.length >= 5) {
    for (const cn of COLLECTIONS) {
      const titleMatches = await db.collection(cn).find(
        {
          normalized_title: normTitle,
          normalized_author: normAuthor,
        },
        { projection: VIS_PROJ }
      ).limit(5).toArray();

      for (const tm of titleMatches) {
        const id = tm.id || tm._id.toString();
        if (seen(id)) continue;

        // Different edition? Only conclude so when BOTH sides carry the signal —
        // a missing year/volume can't distinguish editions, so fall back to
        // treating the title+author collision as a duplicate (the safe error).
        const tmYear = editionYear(tm as { year?: number | null; published?: string | null });
        const tmVol = extractVolume(tm.display_title) ?? extractVolume(tm.title);
        const differentYear = candYear != null && tmYear != null && candYear !== tmYear;
        const differentVolume = candVol != null && tmVol != null && candVol !== tmVol;
        if (differentYear || differentVolume) continue;

        matches.push({
          matchedBookId: id,
          matchedTitle: tm.title,
          matchType: 'title_author',
          confidence: 'high',
          matchedVisible: tm.visible === true,
          matchedCollection: cn,
        });
      }
    }
  }

  // Tier 3: IIIF manifest URL match (exact)
  if (book.image_source?.iiif_manifest) {
    for (const cn of COLLECTIONS) {
      const iiifMatch = await db.collection(cn).findOne(
        {
          'image_source.iiif_manifest': book.image_source.iiif_manifest,
        },
        { projection: VIS_PROJ }
      );
      if (iiifMatch) {
        const id = iiifMatch.id || iiifMatch._id.toString();
        if (!seen(id)) matches.push({
          matchedBookId: id,
          matchedTitle: iiifMatch.title,
          matchType: 'iiif_manifest',
          confidence: 'exact',
          matchedVisible: iiifMatch.visible === true,
          matchedCollection: cn,
        });
      }
    }
  }

  return {
    isDuplicate: matches.length > 0,
    matches,
  };
}

/**
 * Backfill normalized fields and source fingerprints on a collection.
 * Run once to populate, then maintained at import time. Defaults to `books`;
 * pass 'books_warehouse' to populate the warehouse so dedup can match it.
 */
export async function backfillDedupFields(
  db: Db,
  collectionName: 'books' | 'books_warehouse' = 'books'
): Promise<{ updated: number; skipped: number }> {
  const cursor = db.collection(collectionName).find(
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
      await db.collection(collectionName).bulkWrite(bulk);
      updated += bulk.length;
      bulk.length = 0;
    }
  }

  if (bulk.length > 0) {
    await db.collection(collectionName).bulkWrite(bulk);
    updated += bulk.length;
  }

  return { updated, skipped };
}

/**
 * Scan ALL books (visible AND hidden) for duplicates and return groups.
 * Used for periodic auditing. Scans hidden too: the import backlog is hidden,
 * and that is exactly where unnoticed duplicates accumulate.
 */
export async function scanForDuplicates(db: Db): Promise<{
  fingerprintDupes: Array<{ fingerprint: string; count: number; bookIds: string[]; titles: string[] }>;
  titleAuthorDupes: Array<{ normalizedTitle: string; normalizedAuthor: string; count: number; bookIds: string[]; titles: string[] }>;
}> {
  // Find duplicate fingerprints
  const fpDupes = await db.collection('books').aggregate([
    { $match: { source_fingerprint: { $exists: true, $ne: null } } },
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
