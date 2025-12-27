import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/gallery
 *
 * Fetch pages with illustrations for the gallery view.
 * Query params:
 *   - limit: number of pages (default 50, max 200)
 *   - offset: pagination offset
 *   - bookId: filter by book
 *   - type: filter by image type (woodcut, diagram, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const bookId = searchParams.get('bookId');
    const imageType = searchParams.get('type');

    const db = await getDb();

    // Build query for pages with images
    const query: Record<string, unknown> = {
      $or: [
        { 'detected_images.0': { $exists: true } },
        { 'ocr.data': { $regex: '\\[\\[image:', $options: 'i' } }
      ]
    };

    // Must have an image URL
    query.$and = [
      {
        $or: [
          { cropped_photo: { $exists: true, $ne: '' } },
          { photo_original: { $exists: true, $ne: '' } },
          { photo: { $exists: true, $ne: '' } }
        ]
      }
    ];

    if (bookId) {
      query.book_id = bookId;
    }

    if (imageType) {
      query['detected_images.type'] = imageType;
    }

    // Get total count
    const total = await db.collection('pages').countDocuments(query);

    // Fetch pages with book info
    const pages = await db.collection('pages').aggregate([
      { $match: query },
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

    // Process pages to extract image descriptions
    const items = pages.map(page => {
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;

      // Get descriptions from detected_images or parse from OCR
      let descriptions: Array<{ description: string; type?: string }> = [];

      if (page.detected_images?.length > 0) {
        descriptions = page.detected_images.map((img: { description: string; type?: string }) => ({
          description: img.description,
          type: img.type
        }));
      } else if (page.ocr?.data) {
        // Parse [[image: description]] tags from OCR
        const matches = page.ocr.data.matchAll(/\[\[image:\s*([^\]]+)\]\]/gi);
        for (const match of matches) {
          descriptions.push({ description: match[1].trim() });
        }
      }

      return {
        pageId: page.id,
        bookId: page.book_id,
        pageNumber: page.page_number,
        imageUrl,
        bookTitle: page.book?.title || 'Unknown',
        author: page.book?.author,
        year: page.book?.year,
        descriptions,
        hasVisionExtraction: page.detected_images?.some(
          (img: { detection_source?: string }) => img.detection_source === 'vision_model'
        ) || false
      };
    });

    // Get unique books for filtering
    const books = await db.collection('pages').aggregate([
      { $match: query },
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
