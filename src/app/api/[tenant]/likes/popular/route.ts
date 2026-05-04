/**
 * Tenant Popular Likes API
 *
 * GET /api/[tenant]/likes/popular - Get most liked items
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { LikeTargetType } from '@/lib/types';
import { buildCropUrl } from '@/lib/social-image-selector';
import { resolveTenantId } from '@/lib/tenant-context';

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

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  try {
    const { tenant } = await params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const targetType = (searchParams.get('type') || 'image') as LikeTargetType;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const minLikes = parseInt(searchParams.get('min_likes') || '1', 10);

    const db = await getReadDb();

    const popularPipeline = [
      {
        $match: {
          tenantId,
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
      return NextResponse.json({ items: [], total: 0 }, { headers: CACHE_HEADERS });
    }

    if (targetType === 'image') {
      const parsedItems = popularItems.map(item => {
        const galleryImageId = item._id as string;
        const match = galleryImageId.match(/^(.+)[:\-](\d+)$/);
        const pageId = match?.[1] ?? galleryImageId;
        const detectionIndex = match ? parseInt(match[2], 10) : 0;
        return { galleryImageId, pageId, detectionIndex, count: item.count };
      });

      const pageIds = [...new Set(parsedItems.map(p => p.pageId))];
      const pagesData = await db.collection('pages').find(
        { id: { $in: pageIds }, tenantId },
        { projection: { id: 1, book_id: 1, page_number: 1, photo_original: 1, cropped_photo: 1, archived_photo: 1, detected_images: 1 } }
      ).toArray();
      const pagesMap = new Map(pagesData.map(p => [p.id, p]));

      const bookIds = [...new Set(pagesData.map(p => p.book_id))];
      const booksData = await db.collection('books').find(
        { id: { $in: bookIds }, tenantId },
        { projection: { id: 1, title: 1, author: 1, year: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      const enrichedImages: PopularImage[] = [];

      for (const item of parsedItems) {
        const page = pagesMap.get(item.pageId);
        if (!page || !page.detected_images?.[item.detectionIndex]) continue;

        const detection = page.detected_images[item.detectionIndex];
        const book = booksMap.get(page.book_id);
        if (!book) continue;

        const croppedUrl = buildCropUrl(
          {
            pageId: item.pageId,
            detectionIndex: item.detectionIndex,
            galleryImageId: item.galleryImageId,
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
          galleryImageId: item.galleryImageId,
          pageId: item.pageId,
          detectionIndex: item.detectionIndex,
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

      return NextResponse.json({ items: enrichedImages, total: enrichedImages.length }, { headers: CACHE_HEADERS });
    }

    if (targetType === 'book') {
      const bookIds = popularItems.map(item => item._id as string);
      const booksData = await db.collection('books').find(
        { id: { $in: bookIds }, tenantId },
        { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, thumbnail_blob: 1, image_thumb: 1, cover_image: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      const galleryImages = await db.collection('gallery_images').aggregate([
        { $match: { tenantId, book_id: { $in: bookIds }, gallery_quality: { $gte: 0.6 }, extracted_url: { $exists: true, $ne: null } } },
        { $sort: { gallery_quality: -1 } },
        { $group: { _id: '$book_id', images: { $push: { url: '$extracted_url', description: '$description', type: '$type' } } } },
        { $project: { images: { $slice: ['$images', 3] } } },
      ]).toArray();
      const galleryMap = new Map(galleryImages.map(g => [g._id, g.images]));

      const booksWithoutGallery = bookIds.filter(id => !galleryMap.has(id));
      let thumbMap = new Map<string, string>();
      if (booksWithoutGallery.length > 0) {
        const thumbnailPages = await db.collection('pages').find(
          { book_id: { $in: booksWithoutGallery }, page_number: 1, tenantId },
          { projection: { book_id: 1, thumbnail_blob: 1, image_thumb: 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }
        ).toArray();
        thumbMap = new Map(thumbnailPages.map(p => [p.book_id, p.archived_photo || p.cropped_photo || p.photo || p.thumbnail_blob]));
      }

      const enrichedBooks = popularItems
        .map(item => {
          const book = booksMap.get(item._id as string);
          if (!book) return null;
          const gallery = galleryMap.get(book.id) || [];
          return {
            id: book.id,
            slug: book.slug,
            title: book.display_title || book.title,
            author: book.author,
            year: book.year,
            published: book.published,
            language: book.language,
            pages_count: book.pages_count,
            pages_ocr: book.pages_ocr,
            pages_translated: book.pages_translated,
            thumbnail: book.cover_image || thumbMap.get(book.id) || book.thumbnail_blob,
            featured_images: gallery,
            likeCount: item.count,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ items: enrichedBooks, total: enrichedBooks.length }, { headers: CACHE_HEADERS });
    }

    if (targetType === 'page') {
      const pageIds = popularItems.map(item => item._id as string);
      const pagesData = await db.collection('pages').find(
        { id: { $in: pageIds }, tenantId },
        { projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1, thumbnail_blob: 1, image_thumb: 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }
      ).toArray();
      const pagesMap = new Map(pagesData.map(p => [p.id, p]));

      const bookIds = [...new Set(pagesData.map(p => p.book_id))];
      const booksData = await db.collection('books').find(
        { id: { $in: bookIds }, tenantId },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      const enrichedPages = popularItems
        .map(item => {
          const page = pagesMap.get(item._id as string);
          if (!page) return null;
          const book = booksMap.get(page.book_id);
          const rawText = page.translation?.data || page.ocr?.data || '';
          const text = rawText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          return {
            id: page.id,
            pageNumber: page.page_number,
            bookId: page.book_id,
            bookTitle: book ? (book.display_title || book.title) : 'Unknown',
            bookAuthor: book?.author,
            bookYear: book?.year,
            thumbnail: page.thumbnail_blob || page.archived_photo || page.cropped_photo || page.photo,
            excerpt: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
            likeCount: item.count,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ items: enrichedPages, total: enrichedPages.length }, { headers: CACHE_HEADERS });
    }

    return NextResponse.json({
      items: popularItems.map(item => ({ id: item._id, likeCount: item.count })),
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
