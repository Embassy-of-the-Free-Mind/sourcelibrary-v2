import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateQueryEmbedding, cosineSimilarity } from '@/lib/embeddings';

export const maxDuration = 30;

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
 *   - maxPerBook: max images per book (via book_rank), default 2
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
    const imageType = searchParams.get('type');
    const subjectFilter = searchParams.get('subject');
    const figureFilter = searchParams.get('figure');
    const symbolFilter = searchParams.get('symbol');
    const yearStart = searchParams.get('yearStart') ? parseInt(searchParams.get('yearStart')!) : null;
    const yearEnd = searchParams.get('yearEnd') ? parseInt(searchParams.get('yearEnd')!) : null;
    const includeArchive = searchParams.get('includeArchive') === 'true';
    const maxPerBook = parseInt(searchParams.get('maxPerBook') || '2');

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

    // Build query filter
    const filter: Record<string, unknown> = {
      gallery_quality: { $gte: minQuality },
    };

    // Book diversity: limit to top N images per book (unless filtering by book)
    if (!bookId) {
      filter.book_rank = { $lte: maxPerBook };
    }

    if (bookId) filter.book_id = bookId;
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
      filter.$or = [
        { description: { $regex: searchQuery, $options: 'i' } },
        { museum_description: { $regex: searchQuery, $options: 'i' } },
        { 'metadata.subjects': { $regex: searchQuery, $options: 'i' } },
        { 'metadata.figures': { $regex: searchQuery, $options: 'i' } },
        { 'metadata.symbols': { $regex: searchQuery, $options: 'i' } },
      ];
    }

    // Run query and count in parallel
    const [items, total] = await Promise.all([
      db.collection('gallery_images')
        .find(filter, { projection: { _id: 0 } })
        .sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('gallery_images').countDocuments(filter),
    ]);

    // Map to GalleryItem format (camelCase for API consumers)
    const mappedItems = items.map(doc => ({
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
    }));

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
      conditions.push({
        $or: [
          { [`${p}description`]: { $regex: searchQuery, $options: 'i' } },
          { [`${p}museum_description`]: { $regex: searchQuery, $options: 'i' } },
          { [`${p}metadata.subjects`]: { $regex: searchQuery, $options: 'i' } },
          { [`${p}metadata.figures`]: { $regex: searchQuery, $options: 'i' } },
          { [`${p}metadata.symbols`]: { $regex: searchQuery, $options: 'i' } },
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

  pipeline.push({ $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } });
  pipeline.push({ $unwind: { path: '$book', preserveNullAndEmptyArrays: true } });

  if (yearStart !== null || yearEnd !== null) {
    const yearMatch: Record<string, unknown> = {};
    if (yearStart !== null) yearMatch['book.year'] = { $gte: yearStart };
    if (yearEnd !== null) yearMatch['book.year'] = { ...(yearMatch['book.year'] as object), $lte: yearEnd };
    pipeline.push({ $match: yearMatch });
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
