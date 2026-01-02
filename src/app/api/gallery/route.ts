import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  detection_source?: string;
  model?: 'gemini' | 'mistral' | 'grounding-dino';
}

/**
 * GET /api/gallery
 *
 * Fetch illustrations for gallery view.
 * Returns individual images (not pages) with bounding boxes for cropping.
 *
 * Query params:
 *   - limit: number of images (default 50, max 200)
 *   - offset: pagination offset
 *   - bookId: filter by book
 *   - type: filter by image type (woodcut, diagram, etc.)
 *   - verified: if "true", only show vision-extracted images with bboxes
 *   - model: filter by extraction model ('gemini' or 'mistral')
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const bookId = searchParams.get('bookId');
    const imageType = searchParams.get('type');
    const verifiedOnly = searchParams.get('verified') === 'true';
    const modelFilter = searchParams.get('model') as 'gemini' | 'mistral' | null;

    const db = await getDb();

    // Build query - for verified, get vision-extracted OR manual images with bboxes
    const elemMatchConditions: Record<string, unknown> = {
      $or: [
        { detection_source: 'vision_model' },
        { detection_source: 'manual' }
      ],
      bbox: { $exists: true }
    };
    if (modelFilter) {
      elemMatchConditions.model = modelFilter;
    }

    const query: Record<string, unknown> = verifiedOnly
      ? {
          'detected_images': {
            $elemMatch: elemMatchConditions
          }
        }
      : {
          $or: [
            { 'detected_images.0': { $exists: true } },
            { 'ocr.data': { $regex: '\\[\\[image:', $options: 'i' } }
          ]
        };

    // Must have an image URL
    const imageUrlCondition = {
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    if (imageType) {
      query['detected_images.type'] = imageType;
    }

    // Combine conditions
    const fullQuery = { $and: [query, imageUrlCondition] };

    // For verified images, we need to unwind detected_images to get individual items
    if (verifiedOnly) {
      const unwindMatch: Record<string, unknown> = {
        $or: [
          { 'detected_images.detection_source': 'vision_model' },
          { 'detected_images.detection_source': 'manual' }
        ],
        'detected_images.bbox': { $exists: true }
      };
      if (modelFilter) {
        unwindMatch['detected_images.model'] = modelFilter;
      }

      const pipeline = [
        { $match: fullQuery },
        { $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } },
        { $match: unwindMatch },
        {
          $lookup: {
            from: 'books',
            localField: 'book_id',
            foreignField: 'id',
            as: 'book'
          }
        },
        { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
        // Add sort priority: manual first (0), then vision_model (1)
        {
          $addFields: {
            sortPriority: {
              $cond: {
                if: { $eq: ['$detected_images.detection_source', 'manual'] },
                then: 0,
                else: 1
              }
            }
          }
        },
        { $sort: { sortPriority: 1, 'detected_images.confidence': -1, book_id: 1, page_number: 1 } },
        {
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
                  bookTitle: { $ifNull: ['$book.title', 'Unknown'] },
                  author: '$book.author',
                  year: '$book.year',
                  description: '$detected_images.description',
                  type: '$detected_images.type',
                  bbox: '$detected_images.bbox',
                  confidence: '$detected_images.confidence',
                  model: '$detected_images.model',
                  detectionSource: '$detected_images.detection_source',
                  galleryQuality: { $ifNull: ['$detected_images.gallery_quality', null] },
                  galleryRationale: { $ifNull: ['$detected_images.gallery_rationale', null] },
                  featured: { $ifNull: ['$detected_images.featured', null] }
                }
              }
            ],
            total: [{ $count: 'count' }]
          }
        }
      ];

      const [result] = await db.collection('pages').aggregate(pipeline).toArray();
      const items = result.items || [];
      const total = result.total[0]?.count || 0;

      // Get unique books
      const books = await db.collection('pages').aggregate([
        { $match: fullQuery },
        { $group: { _id: '$book_id' } },
        {
          $lookup: {
            from: 'books',
            localField: '_id',
            foreignField: 'id',
            as: 'book'
          }
        },
        { $unwind: '$book' },
        { $project: { id: '$_id', title: '$book.title' } },
        { $sort: { title: 1 } }
      ]).toArray();

      return NextResponse.json({
        items,
        total,
        limit,
        offset,
        books,
        verified: true,
        imageTypes: ['woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'decorative', 'table']
      });
    }

    // Non-verified: return pages with any image indicators
    const total = await db.collection('pages').countDocuments(fullQuery);

    const pages = await db.collection('pages').aggregate([
      { $match: fullQuery },
      { $sort: { book_id: 1, page_number: 1 } },
      { $skip: offset },
      { $limit: limit },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: 1,
          page_number: 1,
          book_id: 1,
          photo: 1,
          photo_original: 1,
          cropped_photo: 1,
          detected_images: 1,
          'ocr.data': 1,
          'book.title': 1,
          'book.author': 1,
          'book.year': 1
        }
      }
    ]).toArray();

    // Flatten: each detected_image becomes a gallery item
    const items: Array<{
      pageId: string;
      bookId: string;
      pageNumber: number;
      imageUrl: string;
      bookTitle: string;
      author?: string;
      year?: number;
      description: string;
      type?: string;
      bbox?: { x: number; y: number; width: number; height: number };
      confidence?: number;
      model?: 'gemini' | 'mistral' | 'grounding-dino';
      galleryQuality?: number;
      galleryRationale?: string;
      featured?: boolean;
    }> = [];

    for (const page of pages) {
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;
      if (!imageUrl) continue;

      if (page.detected_images?.length > 0) {
        // Add each detected image as separate item
        for (const img of page.detected_images as DetectedImage[]) {
          items.push({
            pageId: page.id,
            bookId: page.book_id,
            pageNumber: page.page_number,
            imageUrl,
            bookTitle: page.book?.title || 'Unknown',
            author: page.book?.author,
            year: page.book?.year,
            description: img.description,
            type: img.type,
            bbox: img.bbox,
            confidence: img.confidence,
            model: img.model,
            galleryQuality: img.gallery_quality,
            galleryRationale: img.gallery_rationale,
            featured: img.featured
          });
        }
      } else if (page.ocr?.data) {
        // Parse <image-desc>...</image-desc> (new) and [[image: description]] (legacy) from OCR
        const xmlMatches = page.ocr.data.matchAll(/<image-desc>([\s\S]*?)<\/image-desc>/gi);
        for (const match of xmlMatches) {
          items.push({
            pageId: page.id,
            bookId: page.book_id,
            pageNumber: page.page_number,
            imageUrl,
            bookTitle: page.book?.title || 'Unknown',
            author: page.book?.author,
            year: page.book?.year,
            description: match[1].trim()
          });
        }
        // Legacy bracket syntax
        const bracketMatches = page.ocr.data.matchAll(/\[\[image:\s*([^\]]+)\]\]/gi);
        for (const match of bracketMatches) {
          items.push({
            pageId: page.id,
            bookId: page.book_id,
            pageNumber: page.page_number,
            imageUrl,
            bookTitle: page.book?.title || 'Unknown',
            author: page.book?.author,
            year: page.book?.year,
            description: match[1].trim()
          });
        }
      }
    }

    // Get unique books
    const books = await db.collection('pages').aggregate([
      { $match: fullQuery },
      { $group: { _id: '$book_id' } },
      {
        $lookup: {
          from: 'books',
          localField: '_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: '$book' },
      { $project: { id: '$_id', title: '$book.title' } },
      { $sort: { title: 1 } }
    ]).toArray();

    return NextResponse.json({
      items,
      total: items.length, // Actual count after flattening
      limit,
      offset,
      books,
      verified: false,
      imageTypes: ['woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'decorative', 'table']
    });
  } catch (error) {
    console.error('Gallery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch gallery' },
      { status: 500 }
    );
  }
}
