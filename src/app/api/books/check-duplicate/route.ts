import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { checkDuplicate, normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { searchBookIds } from '@/lib/books-catalog';
import { semanticBookSearch } from '@/lib/semantic-search';

export const preferredRegion = 'fra1';

/**
 * GET /api/books/check-duplicate?title=X&author=Y&year=Z
 *
 * Pre-import dedup check. Returns potential matches across 4 tiers:
 *   1. Source fingerprint (exact: same provider+identifier)
 *   2. Title+Author normalization (fuzzy: same work, different source)
 *   3. Supabase trigram (keyword: title/author substring match)
 *   4. Semantic similarity (conceptual: different title, same work)
 *
 * Query params:
 *   title      — book title (required)
 *   author     — author name (optional but recommended)
 *   year       — publication year (optional, for ranking)
 *   ia_id      — Internet Archive identifier (optional, for fingerprint)
 *   manifest   — IIIF manifest URL (optional, for fingerprint)
 *   language   — language hint for semantic search (optional)
 *
 * Response:
 *   { isDuplicate, confidence, matches[], suggestion }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') || '';
  const author = searchParams.get('author') || '';
  const year = searchParams.get('year');
  const iaId = searchParams.get('ia_id');
  const manifest = searchParams.get('manifest');
  const language = searchParams.get('language');

  if (!title || title.length < 2) {
    return NextResponse.json(
      { error: 'title parameter required (min 2 chars)' },
      { status: 400 }
    );
  }

  const db = await getReadDb();

  interface Match {
    book_id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author?: string;
    language?: string;
    year?: number;
    match_type: 'source_fingerprint' | 'title_author' | 'iiif_manifest' | 'edition_key' | 'keyword' | 'semantic';
    confidence: 'exact' | 'high' | 'medium' | 'low';
    similarity?: number;
    url: string;
  }

  const matches: Match[] = [];
  const seenIds = new Set<string>();

  // ── Tier 1 & 2: Existing dedup system (fingerprint + title+author) ──
  const bookInput: any = { title, author };
  if (iaId) bookInput.ia_identifier = iaId;
  if (manifest) bookInput.image_source = { iiif_manifest: manifest };

  const dedupResult = await checkDuplicate(db, bookInput);
  if (dedupResult.matches.length > 0) {
    // Enrich with full metadata
    const ids = dedupResult.matches.map(m => m.matchedBookId);
    const books = await db.collection('books')
      .find({ id: { $in: ids } })
      .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1 })
      .toArray();
    const bookMap = new Map(books.map(b => [b.id, b]));

    for (const m of dedupResult.matches) {
      seenIds.add(m.matchedBookId);
      const book = bookMap.get(m.matchedBookId);
      matches.push({
        book_id: m.matchedBookId,
        slug: book?.slug,
        title: m.matchedTitle,
        display_title: book?.display_title,
        author: book?.author,
        language: book?.language,
        year: book?.year,
        match_type: m.matchType,
        confidence: m.confidence,
        url: `https://sourcelibrary.org/book/${book?.slug || m.matchedBookId}`,
      });
    }
  }

  // ── Tier 3: Supabase trigram keyword search ──
  // Catches partial title matches the normalization layer misses
  const searchTerms = [title];
  if (author && author.length >= 3) searchTerms.push(author);

  for (const term of searchTerms) {
    try {
      const ids = await searchBookIds(term, { limit: 10 });
      if (ids.length > 0) {
        const newIds = ids.filter(id => !seenIds.has(id));
        if (newIds.length > 0) {
          const books = await db.collection('books')
            .find({ id: { $in: newIds }, visible: true, pages_count: { $gt: 0 } })
            .project({ id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1 })
            .maxTimeMS(3000)
            .toArray();

          for (const book of books) {
            if (seenIds.has(book.id)) continue;
            seenIds.add(book.id);

            // Score the match: how similar is the title?
            const normInput = normalizeTitle(title);
            const normBook = normalizeTitle(book.title || '');
            const titleMatch = normInput === normBook ? 'high'
              : normBook.includes(normInput) || normInput.includes(normBook) ? 'medium'
              : 'low';

            matches.push({
              book_id: book.id,
              slug: book.slug,
              title: book.title,
              display_title: book.display_title,
              author: book.author,
              language: book.language,
              year: book.year,
              match_type: 'keyword',
              confidence: titleMatch as 'high' | 'medium' | 'low',
              url: `https://sourcelibrary.org/book/${book.slug || book.id}`,
            });
          }
        }
      }
    } catch {
      // Non-fatal: keyword search can fail
    }
  }

  // ── Tier 4: Semantic similarity ──
  // Catches cross-lingual and alternate-title matches
  // "Panchatantra" → Kalila wa-Dimna, "Muqaddimah" → "Prolegomenes"
  try {
    const searchQuery = `${title}${author ? ' by ' + author : ''}`;
    const semanticResults = await semanticBookSearch(searchQuery, 8, {
      language: language || undefined,
      threshold: 0.63, // Lower threshold for dedup — prefer high recall (catch possible dupes)
    });

    for (const sem of semanticResults) {
      if (seenIds.has(sem.book_id)) continue;
      seenIds.add(sem.book_id);

      // Fetch slug for URL
      const book = await db.collection('books')
        .findOne({ id: sem.book_id }, { projection: { slug: 1 } });

      matches.push({
        book_id: sem.book_id,
        slug: book?.slug,
        title: sem.title,
        author: sem.author || undefined,
        language: sem.language || undefined,
        year: sem.year || undefined,
        match_type: 'semantic',
        confidence: sem.similarity >= 0.78 ? 'high' : sem.similarity >= 0.68 ? 'medium' : 'low',
        similarity: Math.round(sem.similarity * 1000) / 1000,
        url: `https://sourcelibrary.org/book/${book?.slug || sem.book_id}`,
      });
    }
  } catch {
    // Non-fatal: semantic search can fail
  }

  // ── Sort: exact > high > medium > low, then by similarity ──
  const confidenceOrder = { exact: 0, high: 1, medium: 2, low: 3 };
  matches.sort((a, b) => {
    const ca = confidenceOrder[a.confidence];
    const cb = confidenceOrder[b.confidence];
    if (ca !== cb) return ca - cb;
    return (b.similarity || 0) - (a.similarity || 0);
  });

  // ── Overall assessment ──
  const hasExact = matches.some(m => m.confidence === 'exact');
  const hasHigh = matches.some(m => m.confidence === 'high');
  const hasMedium = matches.some(m => m.confidence === 'medium');

  const isDuplicate = hasExact || hasHigh;
  const overallConfidence = hasExact ? 'exact' : hasHigh ? 'high' : hasMedium ? 'medium' : 'none';

  let suggestion: string;
  if (hasExact) {
    suggestion = `Exact duplicate found: "${matches[0].title}". Do not import.`;
  } else if (hasHigh) {
    suggestion = `Likely duplicate: "${matches[0].title}" (${matches[0].match_type}). Check before importing.`;
  } else if (hasMedium) {
    suggestion = `Possible related work found. Review matches before importing.`;
  } else if (matches.length > 0) {
    suggestion = `No strong matches. Low-confidence semantic matches found — likely safe to import.`;
  } else {
    suggestion = `No matches found. Safe to import.`;
  }

  return NextResponse.json({
    query: { title, author, year, language },
    isDuplicate,
    confidence: overallConfidence,
    suggestion,
    matches: matches.slice(0, 15),
    normalization: {
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      source_fingerprint: sourceFingerprint(bookInput),
    },
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
