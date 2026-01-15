import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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

    // Build aggregation pipeline
    const pipeline: object[] = [];

    // Stage 1: Match pages with detected images and image URLs
    const pageMatch: Record<string, unknown> = {
      'detected_images.0': { $exists: true },
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } }
      ]
    };

    if (bookId) {
      pageMatch.book_id = bookId;
    }

    pipeline.push({ $match: pageMatch });

    // Stage 2: Lookup book info (needed for year filtering)
    pipeline.push({
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    });
    pipeline.push({ $unwind: { path: '$book', preserveNullAndEmptyArrays: true } });

    // Stage 3: Filter by year range if specified
    if (yearStart !== null || yearEnd !== null) {
      const yearMatch: Record<string, unknown> = {};
      if (yearStart !== null) {
        yearMatch['book.year'] = { $gte: yearStart };
      }
      if (yearEnd !== null) {
        yearMatch['book.year'] = { ...yearMatch['book.year'] as object, $lte: yearEnd };
      }
      pipeline.push({ $match: yearMatch });
    }

    // Stage 4: Unwind detected_images to get individual items
    pipeline.push({ $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } });

    // Stage 5: Filter individual images
    const imageMatch: Record<string, unknown> = {
      'detected_images.bbox': { $exists: true },
      $or: [
        { 'detected_images.detection_source': 'vision_model' },
        { 'detected_images.detection_source': 'manual' }
      ]
    };

    if (minQuality !== null) {
      imageMatch['detected_images.gallery_quality'] = { $gte: minQuality };
    }
    if (imageType) {
      imageMatch['detected_images.type'] = imageType;
    }
    if (subjectFilter) {
      imageMatch['detected_images.metadata.subjects'] = subjectFilter;
    }
    if (figureFilter) {
      imageMatch['detected_images.metadata.figures'] = figureFilter;
    }
    if (symbolFilter) {
      imageMatch['detected_images.metadata.symbols'] = symbolFilter;
    }
    if (searchQuery) {
      imageMatch['$or'] = [
        { 'detected_images.description': { $regex: searchQuery, $options: 'i' } },
        { 'detected_images.museum_description': { $regex: searchQuery, $options: 'i' } },
        { 'detected_images.metadata.subjects': { $regex: searchQuery, $options: 'i' } },
        { 'detected_images.metadata.figures': { $regex: searchQuery, $options: 'i' } },
        { 'detected_images.metadata.symbols': { $regex: searchQuery, $options: 'i' } }
      ];
    }

    pipeline.push({ $match: imageMatch });

    // Stage 6: Sort by quality, then by book/page
    pipeline.push({
      $sort: {
        'detected_images.gallery_quality': -1,
        'book.year': 1,
        'book_id': 1,
        'page_number': 1
      }
    });

    // Stage 7: Facet for pagination and aggregations
    pipeline.push({
      $facet: {
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
              confidence: '$detected_images.confidence',
              galleryQuality: '$detected_images.gallery_quality',
              museumDescription: '$detected_images.museum_description',
              metadata: '$detected_images.metadata'
            }
          }
        ],
        total: [{ $count: 'count' }],
        // Aggregate available filters
        types: [
          { $group: { _id: '$detected_images.type' } },
          { $match: { _id: { $ne: null } } },
          { $sort: { _id: 1 } }
        ],
        subjects: [
          { $unwind: { path: '$detected_images.metadata.subjects', preserveNullAndEmptyArrays: false } },
          { $group: { _id: '$detected_images.metadata.subjects' } },
          { $sort: { _id: 1 } },
          { $limit: 50 }
        ],
        figures: [
          { $unwind: { path: '$detected_images.metadata.figures', preserveNullAndEmptyArrays: false } },
          { $group: { _id: '$detected_images.metadata.figures' } },
          { $sort: { _id: 1 } },
          { $limit: 50 }
        ],
        symbols: [
          { $unwind: { path: '$detected_images.metadata.symbols', preserveNullAndEmptyArrays: false } },
          { $group: { _id: '$detected_images.metadata.symbols' } },
          { $sort: { _id: 1 } },
          { $limit: 50 }
        ],
        yearRange: [
          { $group: {
            _id: null,
            minYear: { $min: '$book.year' },
            maxYear: { $max: '$book.year' }
          }}
        ]
      }
    });

    const [result] = await db.collection('pages').aggregate(pipeline).toArray();

    // Handle empty aggregation result to prevent TypeError
    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;
    const types = result?.types?.map((t: { _id: string }) => t._id).filter(Boolean) || [];
    const subjects = result?.subjects?.map((s: { _id: string }) => s._id).filter(Boolean) || [];
    const figures = result?.figures?.map((f: { _id: string }) => f._id).filter(Boolean) || [];
    const symbols = result?.symbols?.map((s: { _id: string }) => s._id).filter(Boolean) || [];
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

    return NextResponse.json({
      items,
      total,
      limit,
      offset,
      bookInfo,
      filters: {
        types,
        subjects,
        figures,
        symbols,
        yearRange
      }
    });
  } catch (error) {
    console.error('Gallery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch gallery' },
      { status: 500 }
    );
  }
}
