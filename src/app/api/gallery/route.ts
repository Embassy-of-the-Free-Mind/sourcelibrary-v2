import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateQueryEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 30;

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

    // Semantic search mode — uses embeddings
    const semantic = searchParams.get('semantic') === 'true';
    const searchQuery = searchParams.get('q');

    if (semantic && searchQuery) {
      return NextResponse.json(await semanticGallerySearch(searchParams, searchQuery));
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const bookId = searchParams.get('bookId') || searchParams.get('book');
    const collectionSlug = searchParams.get('collection');
    const libraryFilter = searchParams.get('library');
    const imageType = searchParams.get('type');
    const subjectFilter = searchParams.get('subject');
    const figureFilter = searchParams.get('figure');
    const symbolFilter = searchParams.get('symbol');
    const yearStart = searchParams.get('yearStart') ? parseInt(searchParams.get('yearStart')!) : null;
    const yearEnd = searchParams.get('yearEnd') ? parseInt(searchParams.get('yearEnd')!) : null;
    const includeArchive = searchParams.get('includeArchive') === 'true';
    const maxPerBook = parseInt(searchParams.get('maxPerBook') || '3');
    // Quality thresholds
    let minQuality = 0.7; // default: gallery quality
    if (includeArchive) minQuality = 0.5;
    if (searchParams.get('minQuality')) minQuality = parseFloat(searchParams.get('minQuality')!);

    const db = await getDb();

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
        collections: collectionSlug,
        status: { $ne: 'deleted' },
      }) as string[];
    }

    // If filtering by library/provider, resolve to book IDs
    let libraryBookIds: string[] | null = null;
    if (libraryFilter) {
      libraryBookIds = await db.collection('books').distinct('id', {
        'image_source.provider': libraryFilter,
        status: { $ne: 'deleted' },
      }) as string[];
    }

    // Build query filter
    const filter: Record<string, unknown> = {
      gallery_quality: { $gte: minQuality },
      book_hidden: { $ne: true },
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

    if (yearStart !== null || yearEnd !== null) {
      const yearFilter: Record<string, number> = {};
      if (yearStart !== null) yearFilter.$gte = yearStart;
      if (yearEnd !== null) yearFilter.$lte = yearEnd;
      filter.book_year = yearFilter;
    }

    if (searchQuery) {
      // Use $text index (covers description, book_title, book_author)
      // instead of 7-branch regex scan across 73k docs
      filter.$text = { $search: searchQuery };
    }

    // Shuffle is handled client-side — server-side $sample/$skip both timeout on Atlas
    // with broad filters (minQuality=0.5, maxPerBook=999). The shuffle param is ignored.

    // When text searching, sort by relevance first, then quality
    const sortOrder: Record<string, any> = searchQuery
      ? { score: { $meta: 'textScore' }, gallery_quality: -1 }
      : { gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 };
    const projection: Record<string, any> = searchQuery
      ? { _id: 0, score: { $meta: 'textScore' } }
      : { _id: 0 };

    // countDocuments with compound filters takes 20s+ on Atlas (no covering index).
    // Strategy: run find first, then only count if we need pagination info.
    // For first page with full results, total = offset + items.length (or +1 if full page).
    const items = await db.collection('gallery_images')
      .find(filter, { projection })
      .sort(sortOrder)
      .skip(offset)
      .limit(limit + 1) // fetch one extra to know if there are more
      .toArray();

    const hasMore = items.length > limit;
    if (hasMore) items.pop(); // remove the extra probe item

    // Avoid countDocuments entirely — derive total from what we know
    let total: number;
    if (!hasMore && offset === 0) {
      total = items.length; // we have everything
    } else if (!hasMore) {
      total = offset + items.length; // last page
    } else {
      // There are more results — use estimated count as approximation
      total = await db.collection('gallery_images').estimatedDocumentCount();
    }

    // Fetch like counts (and visitor's liked status) for these images
    const visitorId = searchParams.get('visitor_id');
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
      bookInfo = await getBookInfo(db, bookId);
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
async function getGalleryFilters(db: Awaited<ReturnType<typeof getDb>>) {
  if (cachedFilters && (Date.now() - cachedFilters.timestamp) < FILTER_CACHE_TTL_MS) {
    return cachedFilters.data;
  }

  const [typesResult, subjectsResult, yearResult] = await Promise.all([
    db.collection('gallery_images').aggregate([
      { $group: { _id: '$type' } },
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('gallery_images').aggregate([
      { $unwind: '$metadata.subjects' },
      { $group: { _id: '$metadata.subjects' } },
      { $sort: { _id: 1 } },
      { $limit: 50 },
    ]).toArray(),
    db.collection('gallery_images').aggregate([
      {
        $group: {
          _id: null,
          minYear: { $min: '$book_year' },
          maxYear: { $max: '$book_year' },
        },
      },
    ]).toArray(),
  ]);

  const data = {
    types: typesResult.map(t => t._id as string).filter(Boolean),
    subjects: subjectsResult.map(s => s._id as string).filter(Boolean),
    yearRange: (yearResult[0] as { minYear: number | null; maxYear: number | null }) || { minYear: null, maxYear: null },
  };

  cachedFilters = { data, timestamp: Date.now() };
  return data;
}

/**
 * Get book info for book-filtered gallery views
 */
async function getBookInfo(db: Awaited<ReturnType<typeof getDb>>, bookId: string) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return null;

  const [hasOcr, hasImages] = await Promise.all([
    db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' }
    }),
    db.collection('pages').countDocuments({
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
 * Semantic gallery search: embed query, then cosine rank gallery embeddings.
 */
async function semanticGallerySearch(searchParams: URLSearchParams, query: string) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');
  const imageType = searchParams.get('type');

  const db = await getDb();
  const queryEmbedding = await generateQueryEmbedding(query);

  const candidates = await db
    .collection('gallery_embeddings')
    .find({}, { projection: { id: 1, page_id: 1, book_id: 1, detection_index: 1, embedding: 1 } })
    .limit(1000)
    .toArray();

  const scored = candidates
    .map(c => ({
      id: c.id as string,
      pageId: c.page_id as string,
      bookId: c.book_id as string,
      detectionIndex: c.detection_index as number,
      similarity: cosineSimilarity(queryEmbedding, c.embedding as number[]),
    }))
    .sort((a, b) => b.similarity - a.similarity);

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
async function legacyGalleryQuery(db: Awaited<ReturnType<typeof getDb>>, searchParams: URLSearchParams) {
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
  pipeline.push({ $match: { 'book.hidden': { $ne: true } } });

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
