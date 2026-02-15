import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

// In-memory cache keyed by query string (persists for serverless function lifetime)
const galleryCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/gallery
 *
 * Image discovery and search interface.
 * Returns individual images with rich metadata for browsing and filtering.
 *
 * Query params:
 *   - limit: number of images (default 50, max 200)
 *   - offset: pagination offset
 *   - bookId: filter by book
 *   - q: text search across descriptions, subjects, figures, symbols
 *   - type: filter by image type (emblem, woodcut, engraving, etc.)
 *   - yearStart, yearEnd: filter by book publication year range
 *   - subject: filter by subject tag
 *   - figure: filter by figure tag
 *   - symbol: filter by symbol tag
 *   - minQuality: minimum gallery_quality score (0-1), default 0.5
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Return cached result if fresh (keyed on full query string)
    const cacheKey = searchParams.toString() || '__default__';
    const cached = galleryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const bookId = searchParams.get('bookId') || searchParams.get('book');
    const imageType = searchParams.get('type');
    const minQuality = searchParams.get('minQuality') ? parseFloat(searchParams.get('minQuality')!) : 0.5;
    const searchQuery = searchParams.get('q');
    const yearStart = searchParams.get('yearStart') ? parseInt(searchParams.get('yearStart')!) : null;
    const yearEnd = searchParams.get('yearEnd') ? parseInt(searchParams.get('yearEnd')!) : null;
    const subjectFilter = searchParams.get('subject');
    const figureFilter = searchParams.get('figure');
    const symbolFilter = searchParams.get('symbol');

    const db = await getDb();

    // Build image filter conditions — used both as $elemMatch pre-filter and post-unwind filter.
    // $elemMatch only guarantees one match per document; post-unwind filter ensures every
    // unwound element individually satisfies the constraints.
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

    // Stage 1: Match pages with detected images + image URLs (prefilter via $elemMatch)
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

    // Stage 2: Lookup book info (needed for year filtering + sort + projection)
    pipeline.push({
      $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' },
    });
    pipeline.push({ $unwind: { path: '$book', preserveNullAndEmptyArrays: true } });

    // Stage 3: Filter by year range if specified
    if (yearStart !== null || yearEnd !== null) {
      const yearMatch: Record<string, unknown> = {};
      if (yearStart !== null) yearMatch['book.year'] = { $gte: yearStart };
      if (yearEnd !== null) {
        yearMatch['book.year'] = { ...(yearMatch['book.year'] as object), $lte: yearEnd };
      }
      pipeline.push({ $match: yearMatch });
    }

    // Stage 3.5: Strip to fields needed downstream (reduces memory before unwind)
    pipeline.push({
      $project: {
        id: 1, book_id: 1, page_number: 1,
        cropped_photo: 1, photo_original: 1, photo: 1,
        detected_images: 1, book: 1,
      },
    });

    // Stage 4: Unwind to individual images
    pipeline.push({ $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } });

    // Stage 5: Post-unwind filter (same conditions, prefixed with 'detected_images')
    pipeline.push({ $match: { $and: buildImageFilters('detected_images') } });

    // Stage 5.5: Per-book diversity — when browsing the full gallery (no book filter),
    // limit images per book so one book can't dominate the feed.
    if (!bookId) {
      const maxPerBook = parseInt(searchParams.get('maxPerBook') || '3');
      pipeline.push({
        $setWindowFields: {
          partitionBy: '$book_id',
          sortBy: { 'detected_images.gallery_quality': -1 as const },
          output: {
            _bookRank: { $rank: {} },
          },
        },
      });
      pipeline.push({ $match: { _bookRank: { $lte: maxPerBook } } });
    }

    // Stage 6: Sort by quality, then by book/page
    pipeline.push({
      $sort: {
        'detected_images.gallery_quality': -1,
        'book.year': 1,
        'book_id': 1,
        'page_number': 1,
      },
    });

    // Stage 7: Facet — only compute filter aggregations on first page (offset === 0).
    // Filters represent the full result set and don't change between pages.
    const facet: Record<string, object[]> = {
      items: [
        { $skip: offset },
        { $limit: limit },
        {
          $project: {
            pageId: '$id',
            bookId: '$book_id',
            pageNumber: '$page_number',
            detectionIndex: '$detectionIndex',
            imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] },
            bookTitle: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] },
            author: '$book.author',
            year: '$book.year',
            description: '$detected_images.description',
            type: '$detected_images.type',
            bbox: '$detected_images.bbox',
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
        {
          $group: {
            _id: null,
            minYear: { $min: '$book.year' },
            maxYear: { $max: '$book.year' },
          },
        },
      ];
    }

    pipeline.push({ $facet: facet });

    const [result] = await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();

    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;
    const types = result?.types?.map((t: { _id: string }) => t._id).filter(Boolean) || [];
    const subjects = result?.subjects?.map((s: { _id: string }) => s._id).filter(Boolean) || [];
    const yearRange = result?.yearRange?.[0] || { minYear: null, maxYear: null };

    // Get book info if filtered by bookId
    let bookInfo = null;
    if (bookId) {
      const book = await db.collection('books').findOne({ id: bookId });
      if (book) {
        // Check if book has OCR
        const hasOcr = await db.collection('pages').countDocuments({
          book_id: bookId,
          'ocr.data': { $exists: true, $ne: '' }
        });
        // Check if book has extracted images
        const hasImages = await db.collection('pages').countDocuments({
          book_id: bookId,
          'detected_images.0': { $exists: true }
        });
        bookInfo = {
          id: book.id,
          title: book.display_title || book.title,
          author: book.author,
          year: book.year,
          pagesCount: book.pages_count,
          hasOcr: hasOcr > 0,
          ocrPageCount: hasOcr,
          hasImages: hasImages > 0,
          imagesPageCount: hasImages
        };
      }
    }

    const responseData = {
      items,
      total,
      limit,
      offset,
      bookInfo,
      filters: {
        types,
        subjects,
        yearRange,
      },
    };

    // Cache result (cap at 50 entries to bound memory)
    if (galleryCache.size > 50) galleryCache.clear();
    galleryCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Gallery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch gallery' },
      { status: 500 }
    );
  }
}
