/**
 * Popular Likes API
 *
 * GET /api/likes/popular - Get most liked items
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { LikeTargetType } from '@/lib/types';
import { buildCropUrl } from '@/lib/social-image-selector';

interface PopularImage {
  galleryImageId: string;
  pageId: string;
  detectionIndex: number;
  likeCount: number;
  description: string;
  type: string;
  museumDescription?: string;
  croppedUrl: string;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
}

/**
 * GET /api/likes/popular
 *
 * Get most liked items with full data for the social admin.
 *
 * Query params:
 *   - type: 'image' | 'page' | 'book' (default: image)
 *   - limit: number (default: 20, max: 50)
 *   - min_likes: number (default: 1)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetType = (searchParams.get('type') || 'image') as LikeTargetType;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const minLikes = parseInt(searchParams.get('min_likes') || '1');

    const db = await getDb();

    // Get most liked targets
    const popularPipeline = [
      {
        $match: {
          target_type: targetType,
        },
      },
      {
        $group: {
          _id: '$target_id',
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gte: minLikes },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: limit,
      },
    ];

    const popularItems = await db.collection('likes').aggregate(popularPipeline).toArray();

    if (popularItems.length === 0) {
      return NextResponse.json({ items: [], total: 0 });
    }

    // For images, enrich with full data
    if (targetType === 'image') {
      const enrichedImages: PopularImage[] = [];

      for (const item of popularItems) {
        const galleryImageId = item._id as string;
        const [pageId, indexStr] = galleryImageId.split(':');
        const detectionIndex = parseInt(indexStr) || 0;

        // Get page data with detected image
        const page = await db.collection('pages').findOne(
          { id: pageId },
          {
            projection: {
              id: 1,
              book_id: 1,
              page_number: 1,
              photo_original: 1,
              cropped_photo: 1,
              archived_photo: 1,
              detected_images: 1,
            },
          }
        );

        if (!page || !page.detected_images?.[detectionIndex]) {
          continue;
        }

        const detection = page.detected_images[detectionIndex];

        // Get book data
        const book = await db.collection('books').findOne(
          { id: page.book_id },
          {
            projection: {
              id: 1,
              title: 1,
              author: 1,
              year: 1,
            },
          }
        );

        if (!book) {
          continue;
        }

        const croppedUrl = buildCropUrl(
          {
            pageId,
            detectionIndex,
            galleryImageId,
            galleryQuality: detection.gallery_quality || 0,
            shareabilityScore: 0,
            description: detection.description || '',
            type: detection.type || 'illustration',
            bbox: detection.bbox,
            bookId: book.id,
            bookTitle: book.title,
            bookAuthor: book.author,
            bookYear: book.year,
            pageNumber: page.page_number,
            imageUrl: page.archived_photo || page.cropped_photo || page.photo_original,
          },
          'https://sourcelibrary.org'
        );

        enrichedImages.push({
          galleryImageId,
          pageId,
          detectionIndex,
          likeCount: item.count,
          description: detection.description || '',
          type: detection.type || 'illustration',
          museumDescription: detection.museum_description,
          croppedUrl,
          bookId: book.id,
          bookTitle: book.title,
          bookAuthor: book.author,
          bookYear: book.year,
        });
      }

      return NextResponse.json({
        items: enrichedImages,
        total: enrichedImages.length,
      });
    }

    // For pages and books, return basic info
    return NextResponse.json({
      items: popularItems.map(item => ({
        id: item._id,
        likeCount: item.count,
      })),
      total: popularItems.length,
    });
  } catch (error) {
    console.error('Error getting popular items:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get popular items' },
      { status: 500 }
    );
  }
}
