import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import { generateQueryEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { deduplicateByDHash } from '@/lib/dhash';
import { CLIP_URL } from '@/lib/clip';

export const maxDuration = 30;

/**
 * Get CLIP text embedding for a query, then search clip_embeddings via Supabase.
 * Returns gallery_image IDs with visual similarity scores.
 * Fails silently — CLIP search is a boost, not required.
 */
async function clipTextSearch(query: string, limit: number): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  try {
    // Encode query text via CLIP server
    const resp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return results;
    const { embedding } = await resp.json();
    if (!embedding) return results;

    // Search Supabase clip_embeddings
    const { data, error } = await supabase.rpc('match_clip_images', {
      query_embedding: embedding,
      match_threshold: 0.20,
      match_count: limit,
    });
    if (error || !data) return results;

    for (const match of data) {
      // Only gallery images (not artworks or book covers)
      if (match.source_type === 'gallery_image' && match.id) {
        results.set(match.id, match.similarity);
      }
    }
  } catch {
    // CLIP server down or slow — not critical
  }
  return results;
}

/**
 * Escape special regex characters and build a diacritics-insensitive pattern.
 * e.g. "durer" matches "Dürer", "albrecht" matches "Albrecht".
 */
function escapeAndNormalizeRegex(query: string): string {
  // Escape regex special chars
  let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Map ASCII chars to character classes that also match accented variants
  const diacriticMap: Record<string, string> = {
    'a': '[aàáâãäåæ]', 'e': '[eèéêë]', 'i': '[iìíîï]',
    'o': '[oòóôõöø]', 'u': '[uùúûü]', 'c': '[cçč]',
    'n': '[nñ]', 's': '[sšß]', 'z': '[zž]', 'y': '[yýÿ]',
  };
  escaped = escaped.split('').map(ch => diacriticMap[ch.toLowerCase()] || ch).join('');
  return escaped;
}

// In-memory cache for filter aggregations (types, subjects, yearRange)
const FILTER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cachedFilters: { data: { types: string[]; subjects: string[]; yearRange: { minYear: number | null; maxYear: number | null } }; timestamp: number } | null = null;

/**
 * GET /api/gallery
 *
 * Image discovery and search interface — reads from materialized `gallery_images` collection.
 * Falls back to legacy aggregation pipeline if collection is empty.
 *
 * Query params:
 *   - limit: number of images (default 24, max 200)
 *   - offset: pagination offset
 *   - bookId / book: filter by book
 *   - q: text search across descriptions, subjects, figures, symbols
 *   - type: filter by image type (emblem, woodcut, engraving, etc.)
 *   - yearStart, yearEnd: filter by book publication year range
 *   - subject: filter by subject tag
 *   - figure: filter by figure tag
 *   - symbol: filter by symbol tag
 *   - minQuality: minimum gallery_quality score (0-1), default 0.7
 *   - maxPerBook: max images per book (via book_rank), default 3
 *   - includeArchive: show 0.5+ quality images (overrides minQuality to 0.5)
 *   - semantic: use embedding search
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantCtx = getTenantContextFromRequest(request);
    let tenantId = tenantCtx.id;
    if (!tenantId && tenantCtx.slug) {
      tenantId = await resolveTenantId(tenantCtx.slug);
    }
    // Gallery is a global view — skip tenant filter when no context (e.g. /gallery root path)
    const tenantFilter = tenantId ? { tenantId } : {};

    // Visual search mode — uses CLIP image embeddings (text→image)
    const visual = searchParams.get('visual') === 'true';
    // Semantic search mode — uses text embeddings
    const semantic = searchParams.get('semantic') === 'true';
    const searchQuery = searchParams.get('q');

    if (visual && searchQuery) {
      return NextResponse.json(await clipGallerySearch(searchParams, searchQuery));
    }
    if (semantic && searchQuery) {
      return NextResponse.json(await semanticGallerySearch(searchParams, searchQuery));
    }

    const bookId = searchParams.get('bookId') || searchParams.get('book');
    // Allow higher limit when fetching all images for a single book (for navigation)
    const maxLimit = bookId ? 1000 : 200;
    const limit = Math.min(parseInt(searchParams.get('limit') || '24'), maxLimit);
    const offset = parseInt(searchParams.get('offset') || '0');
    const collectionSlug = searchParams.get('collection');
    const libraryFilter = searchParams.get('library');
    const imageType = searchParams.get('type');
    const subjectFilter = searchParams.get('subject');
    const figureFilter = searchParams.get('figure');
    const symbolFilter = searchParams.get('symbol');
    const iconclassFilter = searchParams.get('iconclass');
    const yearStart = searchParams.get('yearStart') ? parseInt(searchParams.get('yearStart')!) : null;
    const yearEnd = searchParams.get('yearEnd') ? parseInt(searchParams.get('yearEnd')!) : null;
    const includeArchive = searchParams.get('includeArchive') === 'true';
    const maxPerBook = parseInt(searchParams.get('maxPerBook') || '3');
    // Quality thresholds
    let minQuality = 0.7; // default: gallery quality
    if (includeArchive) minQuality = 0.5;
    if (searchParams.get('minQuality')) minQuality = parseFloat(searchParams.get('minQuality')!);

    const db = await getReadDb();

    // Check if gallery_images collection exists and has data
    const galleryCount = await db.collection('gallery_images').estimatedDocumentCount();
    if (galleryCount === 0) {
      // Fall back to legacy pipeline
      return NextResponse.json(await legacyGalleryQuery(db, searchParams));
    }

    // If filtering by collection, resolve to book IDs
    let collectionBookIds: string[] | null = null;
    if (collectionSlug) {
      collectionBookIds = await db.collection('books').distinct('id', {
        ...(tenantId ? { tenantId } : {}),
        collections: collectionSlug,
        visible: true,
        pages_count: { $gt: 0 },
      }, { maxTimeMS: 10000 }) as string[];
    }

    // If filtering by library/provider, resolve to book IDs
    let libraryBookIds: string[] | null = null;
    if (libraryFilter) {
      libraryBookIds = await db.collection('books').distinct('id', {
        ...(tenantId ? { tenantId } : {}),
        'image_source.provider': libraryFilter,
        visible: true,
        pages_count: { $gt: 0 },
      }, { maxTimeMS: 10000 }) as string[];
    }

    // Build query filter — exclude images without extracted thumbnails or missing source photos
    const filter: Record<string, unknown> = {
      ...(tenantId ? { tenantId } : {}),
      gallery_quality: { $gte: minQuality },
      book_visible: true,
      extracted_url: { $ne: null },
      image_url: { $ne: null },
    };

    // Book diversity: limit to top N images per book (unless filtering by single book or showing all)
    if (!bookId && maxPerBook < 100) {
      filter.book_rank = { $lte: maxPerBook };
    }

    if (bookId) filter.book_id = bookId;
    if (collectionBookIds && libraryBookIds) {
      // Intersect both sets
      const intersection = collectionBookIds.filter(id => libraryBookIds!.includes(id));
      filter.book_id = { $in: intersection };
    } else if (collectionBookIds) {
      filter.book_id = { $in: collectionBookIds };
    } else if (libraryBookIds) {
      filter.book_id = { $in: libraryBookIds };
    }
    if (imageType) filter.type = imageType;
    if (subjectFilter) filter['metadata.subjects'] = subjectFilter;
    if (figureFilter) filter['metadata.figures'] = figureFilter;
    if (symbolFilter) filter['metadata.symbols'] = symbolFilter;
    if (iconclassFilter) {
      // Prefix match: ?iconclass=49 matches 49E39, 49C11, etc.
      filter['metadata.iconclass'] = { $regex: `^${iconclassFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
    }

    if (yearStart !== null || yearEnd !== null) {
      const yearFilter: Record<string, number> = {};
      if (yearStart !== null) yearFilter.$gte = yearStart;
      if (yearEnd !== null) yearFilter.$lte = yearEnd;
      filter.book_year = yearFilter;
    }

    // Shuffle is handled client-side — server-side $sample/$skip both timeout on Atlas
    // with broad filters (minQuality=0.5, maxPerBook=999). The shuffle param is ignored.

    // Fire CLIP visual search in parallel with text search
    const clipPromise = searchQuery
      ? clipTextSearch(searchQuery, Math.max(limit * 2, 60))
      : Promise.resolve(new Map<string, number>());

    let textItems: any[] = [];

    if (searchQuery) {
      // Primary: Atlas Search (gallery_search index) — searches description,
      // museum_description, subjects, figures. Same index used by unified search.
      try {
        textItems = await db.collection('gallery_images').aggregate([
          {
            $search: {
              index: 'gallery_search',
              compound: {
                should: [
                  { autocomplete: { query: searchQuery, path: 'description', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                  { text: { query: searchQuery, path: 'museum_description', score: { boost: { value: 2 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                  { text: { query: searchQuery, path: 'metadata.subjects', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                  { text: { query: searchQuery, path: 'metadata.figures', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                ],
                minimumShouldMatch: 1,
                filter: [
                  { range: { path: 'gallery_quality', gte: minQuality } },
                ],
              },
            },
          },
          { $match: {
            book_visible: true,
            extracted_url: { $ne: null },
            image_url: { $ne: null },
            ...(!bookId && maxPerBook < 100 ? { book_rank: { $lte: maxPerBook } } : {}),
            ...(bookId ? { book_id: bookId } : {}),
            ...(collectionBookIds && libraryBookIds
              ? { book_id: { $in: collectionBookIds.filter(id => libraryBookIds!.includes(id)) } }
              : collectionBookIds ? { book_id: { $in: collectionBookIds } }
              : libraryBookIds ? { book_id: { $in: libraryBookIds } }
              : {}),
            ...(imageType ? { type: imageType } : {}),
            ...(subjectFilter ? { 'metadata.subjects': subjectFilter } : {}),
            ...(figureFilter ? { 'metadata.figures': figureFilter } : {}),
            ...(symbolFilter ? { 'metadata.symbols': symbolFilter } : {}),
            ...(yearStart !== null || yearEnd !== null ? {
              book_year: {
                ...(yearStart !== null ? { $gte: yearStart } : {}),
                ...(yearEnd !== null ? { $lte: yearEnd } : {}),
              },
            } : {}),
          }},
          { $project: { _id: 0 } },
          { $skip: offset },
          { $limit: limit + 1 },
        ], { maxTimeMS: 8000 }).toArray();
      } catch {
        // Atlas Search index not ready — fall back to $text
      }

      // Fallback: $text index (covers description, book_title, book_author)
      if (textItems.length === 0) {
        filter.$text = { $search: searchQuery };
        const sortOrder: Record<string, any> = { score: { $meta: 'textScore' }, gallery_quality: -1 };
        const projection = { _id: 0, score: { $meta: 'textScore' as const } };
        textItems = await db.collection('gallery_images')
          .find(filter, { projection })
          .sort(sortOrder)
          .skip(offset)
          .limit(limit + 1)
          .toArray();
      }
    } else {
      const sortOrder: Record<string, any> = { gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 };
      textItems = await db.collection('gallery_images')
        .find(filter, { projection: { _id: 0 } })
        .sort(sortOrder)
        .skip(offset)
        .limit(limit + 1)
        .toArray();
    }

    const clipScores = await clipPromise;
    let items = textItems;

    // Book-context fallback: when text search returns few results, use semantic book
    // search (book_embeddings, 17K rows) to find books about the topic, then show
    // their top images. This bridges the gap between book content and image metadata.
    // e.g. "vulva" → semantic search finds anatomy books → shows their illustrations.
    if (searchQuery && items.length < 3 && offset === 0) {
      try {
        const { semanticBookSearch } = await import('@/lib/semantic-search');
        const contextBooks = await semanticBookSearch(searchQuery, 8, { threshold: 0.5 });
        if (contextBooks.length > 0) {
          const existingBookIds = new Set(items.map(doc => doc.book_id));
          const newBookIds = contextBooks
            .map(b => b.book_id)
            .filter(id => !existingBookIds.has(id));
          if (newBookIds.length > 0) {
            const bookImages = await db.collection('gallery_images')
              .find({
                book_id: { $in: newBookIds },
                gallery_quality: { $gte: Math.max(minQuality, 0.7) },
                book_visible: true,
                extracted_url: { $ne: null },
                image_url: { $ne: null },
                book_rank: { $lte: 2 }, // top 2 per book
              }, { projection: { _id: 0 } })
              .sort({ gallery_quality: -1 })
              .limit(limit)
              .toArray();
            if (bookImages.length > 0) {
              const existingIds = new Set(items.map(doc => `${doc.page_id}-${doc.detection_index}`));
              const newImages = bookImages.filter(doc =>
                !existingIds.has(`${doc.page_id}-${doc.detection_index}`)
              );
              items = [...items, ...newImages];
            }
          }
        }
      } catch {
        // Non-critical fallback — proceed with text results only
      }
    }

    // Merge CLIP visual results with text results
    if (clipScores.size > 0) {
      const textIds = new Set(items.map(doc => `${doc.page_id}-${doc.detection_index}`));

      // Find CLIP-only matches (visually relevant but not in text results)
      const clipOnlyIds = [...clipScores.keys()].filter(id => !textIds.has(id));

      if (clipOnlyIds.length > 0) {
        // Fetch full docs for CLIP-only matches
        const clipDocs = await db.collection('gallery_images')
          .find({
            id: { $in: clipOnlyIds },
            ...(tenantId ? { tenantId } : {}),
            gallery_quality: { $gte: minQuality },
            book_visible: true,
            extracted_url: { $ne: null },
          }, { projection: { _id: 0 } })
          .toArray();

        // Append CLIP-only results after text results
        items = [...items, ...clipDocs];
      }
    }

    // Deduplicate visually identical images within the same book (e.g., repeated woodcuts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items = deduplicateByDHash(items as any) as any;

    const hasMore = items.length > limit;
    if (hasMore) items.splice(limit); // trim to limit

    // Derive total — avoid countDocuments for unfiltered browsing, but use it for searches
    let total: number;
    if (!hasMore && offset === 0) {
      total = items.length; // we have everything
    } else if (!hasMore) {
      total = offset + items.length; // last page
    } else if (searchQuery || collectionBookIds || libraryBookIds || imageType || subjectFilter || figureFilter || symbolFilter || iconclassFilter || yearStart !== null || yearEnd !== null) {
      // Filtered query — for Atlas Search queries, countDocuments can't replicate the
      // search pipeline, so estimate from result count. For $text queries, use countDocuments.
      if (searchQuery && !filter.$text) {
        // Atlas Search was used — estimate total from what we have
        total = offset + items.length + (hasMore ? 1 : 0);
      } else {
        total = await db.collection('gallery_images').countDocuments(filter, { maxTimeMS: 10000 }).catch(() => offset + items.length + 1);
      }
    } else {
      // Unfiltered browsing — estimated count is fine
      total = await db.collection('gallery_images').estimatedDocumentCount();
    }

    // Fetch like counts (and visitor's liked status) for these images.
    // Prefer the authenticated user id so likedByVisitor stays correct
    // even when the client hasn't hydrated its session yet.
    const session = await auth();
    const visitorId = session?.user?.id || searchParams.get('visitor_id');
    const imageIds = items.map(doc => `${doc.page_id}-${doc.detection_index}`);
    let likesMap: Record<string, { count: number; liked: boolean }> = {};
    if (imageIds.length > 0) {
      try {
        const likeDocs = await db.collection('likes').aggregate([
          { $match: { target_type: 'image', target_id: { $in: imageIds } } },
          { $group: { _id: '$target_id', count: { $sum: 1 }, visitors: { $addToSet: '$visitor_id' } } },
        ]).toArray();
        for (const ld of likeDocs) {
          likesMap[ld._id as string] = {
            count: ld.count as number,
            liked: visitorId ? (ld.visitors as string[]).includes(visitorId) : false,
          };
        }
      } catch {
        // Non-critical — proceed without like data
      }
    }

    // Map to GalleryItem format (camelCase for API consumers)
    const mappedItems = items.map(doc => {
      const likeKey = `${doc.page_id}-${doc.detection_index}`;
      const likeData = likesMap[likeKey];
      const clipScore = clipScores.get(doc.id || likeKey);
      return {
        pageId: doc.page_id,
        bookId: doc.book_id,
        pageNumber: doc.page_number,
        detectionIndex: doc.detection_index,
        imageUrl: doc.image_url,
        bookTitle: doc.book_title,
        author: doc.book_author,
        year: doc.book_year,
        description: doc.description,
        type: doc.type,
        bbox: doc.bbox,
        rotation: doc.rotation,
        extractedUrl: doc.extracted_url,
        thumbnailUrl: doc.thumbnail_url,
        galleryQuality: doc.gallery_quality,
        confidence: doc.confidence,
        museumDescription: doc.museum_description,
        metadata: doc.metadata,
        firstSyncedAt: doc.first_synced_at || doc.updated_at || null,
        ...(clipScore !== undefined && { visualSimilarity: clipScore }),
        likeCount: likeData?.count ?? 0,
        likedByVisitor: likeData?.liked ?? false,
      };
    });

    // Get filters (cached for 30 min, only compute on first page)
    let filters = { types: [] as string[], subjects: [] as string[], yearRange: { minYear: null as number | null, maxYear: null as number | null } };
    if (offset === 0) {
      filters = await getGalleryFilters(db);
    } else if (cachedFilters && (Date.now() - cachedFilters.timestamp) < FILTER_CACHE_TTL_MS) {
      filters = cachedFilters.data;
    }

    // Get book info if filtered by bookId
    let bookInfo = null;
    if (bookId) {
      bookInfo = await getBookInfo(db, bookId, tenantId || undefined);
    }

    return NextResponse.json({
      items: mappedItems,
      total,
      limit,
      offset,
      bookInfo,
      filters,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('Gallery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch gallery' },
      { status: 500 }
    );
  }
}

/**
 * Get filter options from gallery_images (cached for 30 min)
 */
async function getGalleryFilters(db: Awaited<ReturnType<typeof getReadDb>>) {
  if (cachedFilters && (Date.now() - cachedFilters.timestamp) < FILTER_CACHE_TTL_MS) {
    return cachedFilters.data;
  }

  // Read pre-computed filters from system_config (fast single-doc read).
  // The subjects and year aggregations take 20-40s on Atlas — can't run inline.
  try {
    const cached = await db.collection('system_config').findOne({ _id: 'gallery_filters' } as any);
    if (cached?.data) {
      const data = cached.data as typeof cachedFilters extends null ? never : NonNullable<typeof cachedFilters>['data'];
      cachedFilters = { data, timestamp: Date.now() };
      return data;
    }
  } catch { /* fall through to compute */ }

  // Fallback: compute only the fast aggregation (types). Skip subjects and year range
  // which take 20-40s each and would timeout the request.
  const typesResult = await db.collection('gallery_images').aggregate([
    { $group: { _id: '$type' } },
    { $match: { _id: { $ne: null } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  const data = {
    types: typesResult.map(t => t._id as string).filter(Boolean),
    subjects: [] as string[],
    yearRange: { minYear: 1400 as number | null, maxYear: 1900 as number | null },
  };

  cachedFilters = { data, timestamp: Date.now() };
  return data;
}

/**
 * Get book info for book-filtered gallery views
 */
async function getBookInfo(db: Awaited<ReturnType<typeof getReadDb>>, bookId: string, tenantId?: string) {
  const scope = tenantId ? { tenantId } : {};
  const book = await db.collection('books').findOne({ id: bookId, ...scope });
  if (!book) return null;

  const [hasOcr, hasImages] = await Promise.all([
    db.collection('pages').countDocuments({
      ...scope,
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' }
    }),
    db.collection('pages').countDocuments({
      ...scope,
      book_id: bookId,
      'detected_images.0': { $exists: true }
    }),
  ]);

  return {
    id: book.id,
    slug: book.slug,
    title: book.display_title || book.title,
    author: book.author,
    year: book.year,
    pagesCount: book.pages_count,
    hasOcr: hasOcr > 0,
    ocrPageCount: hasOcr,
    hasImages: hasImages > 0,
    imagesPageCount: hasImages,
  };
}

/**
 * Semantic gallery search: embed query, then find similar via Supabase pgvector.
 * Falls back to MongoDB brute-force cosine if Supabase is unavailable.
 */
async function semanticGallerySearch(searchParams: URLSearchParams, query: string) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');
  const imageType = searchParams.get('type');

  const db = await getReadDb();
  const queryEmbedding = await generateQueryEmbedding(query);

  // Try Supabase pgvector first (instant HNSW search)
  let scored: Array<{ id: string; pageId: string; bookId: string; detectionIndex: number; similarity: number }> = [];

  try {
    const { data: matches, error } = await supabase.rpc('match_gallery_text', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.15,
      match_count: offset + limit + 50, // fetch enough for pagination + filtering
    });

    if (!error && matches && matches.length > 0) {
      scored = matches.map((m: { id: string; page_id: string; book_id: string; detection_index: number; similarity: number }) => ({
        id: m.id,
        pageId: m.page_id,
        bookId: m.book_id,
        detectionIndex: m.detection_index,
        similarity: m.similarity,
      }));
    }
  } catch {
    // Supabase unavailable — fall through
  }

  // Fallback: MongoDB brute-force cosine
  if (scored.length === 0) {
    const candidates = await db
      .collection('gallery_embeddings')
      .find({}, { projection: { id: 1, page_id: 1, book_id: 1, detection_index: 1, embedding: 1 } })
      .limit(1000)
      .toArray();

    scored = candidates
      .map(c => ({
        id: c.id as string,
        pageId: c.page_id as string,
        bookId: c.book_id as string,
        detectionIndex: c.detection_index as number,
        similarity: cosineSimilarity(queryEmbedding, c.embedding as number[]),
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);
  if (page.length === 0) {
    return { items: [], total: 0, limit, offset, semantic: true, bookInfo: null, filters: { types: [], subjects: [], yearRange: {} } };
  }

  // Resolve full items from gallery_images
  const imageIds = page.map(s => `${s.pageId}-${s.detectionIndex}`);
  const docs = await db.collection('gallery_images')
    .find({ id: { $in: imageIds } }, { projection: { _id: 0 } })
    .toArray();
  const docMap = new Map(docs.map(d => [d.id as string, d]));

  const items = page
    .map(s => {
      const doc = docMap.get(`${s.pageId}-${s.detectionIndex}`);
      if (!doc) return null;
      if (doc.book_hidden === true) return null;
      if (imageType && doc.type !== imageType) return null;
      return {
        pageId: doc.page_id,
        bookId: doc.book_id,
        pageNumber: doc.page_number,
        detectionIndex: doc.detection_index,
        imageUrl: doc.extracted_url || doc.thumbnail_url || doc.image_url,
        bookTitle: doc.book_title,
        author: doc.book_author,
        year: doc.book_year,
        description: doc.description || '',
        type: doc.type,
        bbox: doc.bbox,
        rotation: doc.rotation,
        extractedUrl: doc.extracted_url,
        thumbnailUrl: doc.thumbnail_url,
        galleryQuality: doc.gallery_quality,
        museumDescription: doc.museum_description,
        metadata: doc.metadata,
        similarity: Math.round(s.similarity * 1000) / 1000,
      };
    })
    .filter(Boolean);

  return {
    items,
    total,
    limit,
    offset,
    semantic: true,
    bookInfo: null,
    filters: { types: [], subjects: [], yearRange: {} },
  };
}

/**
 * Legacy aggregation pipeline — used as fallback when gallery_images collection is empty.
 */
async function legacyGalleryQuery(db: Awaited<ReturnType<typeof getReadDb>>, searchParams: URLSearchParams) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');
  const bookId = searchParams.get('bookId') || searchParams.get('book');
  const imageType = searchParams.get('type');
  const minQuality = searchParams.get('minQuality') ? parseFloat(searchParams.get('minQuality')!) : 0.5;
  const yearStart = searchParams.get('yearStart') ? parseInt(searchParams.get('yearStart')!) : null;
  const yearEnd = searchParams.get('yearEnd') ? parseInt(searchParams.get('yearEnd')!) : null;
  const subjectFilter = searchParams.get('subject');
  const figureFilter = searchParams.get('figure');
  const symbolFilter = searchParams.get('symbol');
  const iconclassFilter = searchParams.get('iconclass');
  const searchQuery = searchParams.get('q');

  function buildImageFilters(prefix: string) {
    const p = prefix ? `${prefix}.` : '';
    const conditions: Record<string, unknown>[] = [
      { [`${p}bbox`]: { $exists: true } },
      { [`${p}detection_source`]: { $in: ['vision_model', 'manual', 'ocr_tag'] } },
    ];
    if (minQuality !== null) conditions.push({ [`${p}gallery_quality`]: { $gte: minQuality } });
    if (imageType) conditions.push({ [`${p}type`]: imageType });
    if (subjectFilter) conditions.push({ [`${p}metadata.subjects`]: subjectFilter });
    if (figureFilter) conditions.push({ [`${p}metadata.figures`]: figureFilter });
    if (symbolFilter) conditions.push({ [`${p}metadata.symbols`]: symbolFilter });
    if (iconclassFilter) conditions.push({ [`${p}metadata.iconclass`]: { $regex: `^${iconclassFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } });
    if (searchQuery) {
      const pattern = escapeAndNormalizeRegex(searchQuery);
      conditions.push({
        $or: [
          { [`${p}description`]: { $regex: pattern, $options: 'i' } },
          { [`${p}museum_description`]: { $regex: pattern, $options: 'i' } },
          { [`${p}metadata.subjects`]: { $regex: pattern, $options: 'i' } },
          { [`${p}metadata.figures`]: { $regex: pattern, $options: 'i' } },
          { [`${p}metadata.symbols`]: { $regex: pattern, $options: 'i' } },
        ],
      });
    }
    return conditions;
  }

  const pipeline: object[] = [];

  const pageMatch: Record<string, unknown> = {
    'detected_images.0': { $exists: true },
    $or: [
      { cropped_photo: { $exists: true, $ne: '' } },
      { photo_original: { $exists: true, $ne: '' } },
      { photo: { $exists: true, $ne: '' } },
    ],
    detected_images: { $elemMatch: { $and: buildImageFilters('') } },
  };
  if (bookId) pageMatch.book_id = bookId;
  pipeline.push({ $match: pageMatch });

  // Exclude original (unsplit) pages that have been superseded by split children.
  // If another page has split_from pointing to this page's id, this page is a spread
  // and its split children should be shown instead.
  pipeline.push({
    $lookup: {
      from: 'pages',
      localField: 'id',
      foreignField: 'split_from',
      as: '_splitChildren',
      pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
    },
  });
  pipeline.push({ $match: { '_splitChildren.0': { $exists: false } } });
  pipeline.push({ $project: { _splitChildren: 0 } });

  pipeline.push({ $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } });
  pipeline.push({ $unwind: { path: '$book', preserveNullAndEmptyArrays: true } });
  pipeline.push({ $match: { 'book.visible': true } });

  if (yearStart !== null || yearEnd !== null) {
    const yearMatch: Record<string, unknown> = {};
    if (yearStart !== null) yearMatch['book.year'] = { $gte: yearStart };
    if (yearEnd !== null) yearMatch['book.year'] = { ...(yearMatch['book.year'] as object), $lte: yearEnd };
    pipeline.push({ $match: yearMatch });
  }

  // If searching, also match on book title/author after join
  if (searchQuery) {
    const bookPattern = escapeAndNormalizeRegex(searchQuery);
    pipeline.push({
      $match: {
        $or: [
          { 'book.title': { $regex: bookPattern, $options: 'i' } },
          { 'book.display_title': { $regex: bookPattern, $options: 'i' } },
          { 'book.author': { $regex: bookPattern, $options: 'i' } },
          // Also pass through pages that already matched on image-level fields
          { detected_images: { $elemMatch: { $and: buildImageFilters('') } } },
        ],
      },
    });
  }

  pipeline.push({
    $project: {
      id: 1, book_id: 1, page_number: 1,
      cropped_photo: 1, photo_original: 1, photo: 1,
      detected_images: 1, book: 1,
    },
  });

  pipeline.push({ $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } });
  pipeline.push({ $match: { $and: buildImageFilters('detected_images') } });

  if (!bookId) {
    const maxPerBook = parseInt(searchParams.get('maxPerBook') || '3');
    pipeline.push({
      $setWindowFields: {
        partitionBy: '$book_id',
        sortBy: { 'detected_images.gallery_quality': -1 as const },
        output: { _bookRank: { $rank: {} } },
      },
    });
    pipeline.push({ $match: { _bookRank: { $lte: maxPerBook } } });
  }

  pipeline.push({ $sort: { 'detected_images.gallery_quality': -1, 'book.year': 1, book_id: 1, page_number: 1 } });

  const facet: Record<string, object[]> = {
    items: [
      { $skip: offset },
      { $limit: limit },
      {
        $project: {
          pageId: '$id', bookId: '$book_id', pageNumber: '$page_number',
          detectionIndex: '$detectionIndex',
          imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] },
          bookTitle: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] },
          author: '$book.author', year: '$book.year',
          description: '$detected_images.description',
          type: '$detected_images.type', bbox: '$detected_images.bbox',
          rotation: '$detected_images.rotation',
          extractedUrl: '$detected_images.extracted_url',
          thumbnailUrl: '$detected_images.thumbnail_url',
          confidence: '$detected_images.confidence',
          galleryQuality: '$detected_images.gallery_quality',
          museumDescription: '$detected_images.museum_description',
          metadata: '$detected_images.metadata',
        },
      },
    ],
    total: [{ $count: 'count' }],
  };

  if (offset === 0) {
    facet.types = [
      { $group: { _id: '$detected_images.type' } },
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } },
    ];
    facet.subjects = [
      { $unwind: { path: '$detected_images.metadata.subjects', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$detected_images.metadata.subjects' } },
      { $sort: { _id: 1 } },
      { $limit: 50 },
    ];
    facet.yearRange = [
      { $group: { _id: null, minYear: { $min: '$book.year' }, maxYear: { $max: '$book.year' } } },
    ];
  }

  pipeline.push({ $facet: facet });

  const [result] = await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();

  const items = result?.items || [];
  const total = result?.total?.[0]?.count || 0;
  const types = result?.types?.map((t: { _id: string }) => t._id).filter(Boolean) || [];
  const subjects = result?.subjects?.map((s: { _id: string }) => s._id).filter(Boolean) || [];
  const yearRange = result?.yearRange?.[0] || { minYear: null, maxYear: null };

  let bookInfo = null;
  if (bookId) {
    bookInfo = await getBookInfo(db, bookId);
  }

  return {
    items,
    total,
    limit,
    offset,
    bookInfo,
    filters: { types, subjects, yearRange },
  };
}

/**
 * CLIP visual search: encode text query via CLIP text encoder,
 * search against CLIP image embeddings in Supabase.
 * Returns gallery items ranked by visual similarity.
 */
async function clipGallerySearch(searchParams: URLSearchParams, query: string) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');

  // Encode text via CLIP
  let embedding: number[] | null = null;
  try {
    const clipResp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (clipResp.ok) {
      const data = await clipResp.json();
      embedding = data.embedding;
    }
  } catch {
    // Fall through to semantic search fallback
  }

  if (!embedding) {
    // Fall back to text-embedding semantic search
    return semanticGallerySearch(searchParams, query);
  }

  // Search Supabase CLIP embeddings
  const { data: matches, error } = await supabase.rpc('match_clip_text', {
    query_embedding: embedding,
    match_threshold: 0.18,
    match_count: offset + limit + 20,
  });

  if (error || !matches || matches.length === 0) {
    return { items: [], total: 0, limit, offset, visual: true, bookInfo: null, filters: { types: [], subjects: [], yearRange: {} } };
  }

  const total = matches.length;
  const page = (matches as Array<{
    id: string; source_type: string; book_id: string; image_url: string;
    thumbnail_url: string; title: string; author: string; resource_type: string;
    similarity: number;
  }>).slice(offset, offset + limit);

  // Resolve full gallery metadata from MongoDB for gallery_image entries
  const db = await getReadDb();
  const galleryIds = page.filter(m => m.source_type === 'gallery_image').map(m => m.id.replace('gallery-', ''));
  const galleryDocs = galleryIds.length > 0
    ? await db.collection('gallery_images').find({ id: { $in: galleryIds } }, { projection: { _id: 0 } }).toArray()
    : [];
  const galleryMap = new Map(galleryDocs.map(d => [d.id as string, d]));

  const items = page.map(m => {
    // For gallery images, use full metadata from MongoDB
    if (m.source_type === 'gallery_image') {
      const doc = galleryMap.get(m.id.replace('gallery-', ''));
      if (doc) {
        return {
          pageId: doc.page_id,
          bookId: doc.book_id,
          pageNumber: doc.page_number,
          detectionIndex: doc.detection_index,
          imageUrl: doc.extracted_url || doc.thumbnail_url || doc.image_url,
          bookTitle: doc.book_title,
          author: doc.book_author,
          year: doc.book_year,
          description: doc.description || '',
          type: doc.type,
          extractedUrl: doc.extracted_url,
          thumbnailUrl: doc.thumbnail_url,
          galleryQuality: doc.gallery_quality,
          museumDescription: doc.museum_description,
          metadata: doc.metadata,
          similarity: Math.round(m.similarity * 1000) / 1000,
        };
      }
    }
    // For artworks and book covers, use Supabase data directly
    return {
      pageId: null,
      bookId: m.book_id,
      pageNumber: null,
      detectionIndex: null,
      imageUrl: m.thumbnail_url || m.image_url,
      bookTitle: m.title,
      author: m.author,
      year: null,
      description: m.title || '',
      type: m.resource_type,
      extractedUrl: m.image_url,
      thumbnailUrl: m.thumbnail_url,
      galleryQuality: null,
      similarity: Math.round(m.similarity * 1000) / 1000,
    };
  });

  return {
    items,
    total,
    limit,
    offset,
    visual: true,
    bookInfo: null,
    filters: { types: [], subjects: [], yearRange: {} },
  };
}
