/**
 * My Likes API
 *
 * GET /api/likes/mine - Get all likes for a visitor with enriched data
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { auth } from '@/lib/auth';
import { getReadDb } from '@/lib/mongodb';
import { LikeTargetType } from '@/lib/types';
import { buildCropUrl } from '@/lib/social-image-selector';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

/**
 * GET /api/likes/mine
 *
 * Get a visitor's liked items with full enrichment (same shape as /popular).
 *
 * Query params:
 *   - visitor_id: string (required)
 *   - type: 'image' | 'page' | 'book' | 'collection' (required)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const { searchParams } = new URL(request.url);
    const tenantContext = getTenantContextFromRequest(request.headers);
    // Authenticated users always see their own likes regardless of any
    // stale visitor_id the client passes (favorites page still reads
    // localStorage). Anonymous visitors fall back to the supplied param.
    const visitorId = session?.user?.id || searchParams.get('visitor_id');
    const targetType = searchParams.get('type') as LikeTargetType | null;

    if (tenantContext.slug && !tenantContext.id) {
      return NextResponse.json({ items: [], total: 0 });
    }

    if (!visitorId) {
      return NextResponse.json({ error: 'visitor_id is required' }, { status: 400 });
    }
    if (!targetType || !['image', 'page', 'book', 'collection'].includes(targetType)) {
      return NextResponse.json({ error: 'type is required (image, page, book, or collection)' }, { status: 400 });
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 5000);

    const db = await getReadDb();
    const tenantFilter = tenantContext.id ? { tenantId: tenantContext.id } : {};

    const myLikes = await db.collection('likes')
      .find({ visitor_id: visitorId, target_type: targetType, ...tenantFilter })
      .project({ target_id: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    if (myLikes.length === 0) {
      return NextResponse.json({ items: [], total: 0 });
    }

    const targetIds = myLikes.map(l => l.target_id as string);

    // Get like counts for each target
    const countPipeline = [
      { $match: { target_type: targetType, target_id: { $in: targetIds }, ...tenantFilter } },
      { $group: { _id: '$target_id', count: { $sum: 1 } } },
    ];
    const counts = await db.collection('likes').aggregate(countPipeline).toArray();
    const countMap = new Map(counts.map(c => [c._id, c.count]));

    if (targetType === 'collection') {
      // Saved collections, most recently saved first. Liked by slug.
      const colls = await db.collection('collections').find(
        { slug: { $in: targetIds } },
        { projection: { _id: 0, slug: 1, name: 1, description: 1, book_count: 1 } }
      ).toArray();
      const collMap = new Map(colls.map(c => [c.slug as string, c]));
      const items = targetIds
        .map(slug => {
          const c = collMap.get(slug);
          if (!c) return null;
          return { slug, name: c.name, description: c.description, bookCount: c.book_count, likeCount: countMap.get(slug) || 1 };
        })
        .filter(Boolean);
      return NextResponse.json({ items, total: items.length });
    }

    if (targetType === 'book') {
      const booksData = await db.collection('books').find(
        { id: { $in: targetIds }, ...tenantFilter },
        { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, thumbnail_blob: 1, image_thumb: 1, cover_image: 1, content_type: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      // Get top 3 extracted illustrations per book
      const galleryImages = await db.collection('gallery_images').aggregate([
        { $match: { book_id: { $in: targetIds }, gallery_quality: { $gte: 0.6 }, extracted_url: { $exists: true, $ne: null }, ...tenantFilter } },
        { $sort: { gallery_quality: -1 } },
        { $group: { _id: '$book_id', images: { $push: { url: '$extracted_url', description: '$description', type: '$type' } } } },
        { $project: { images: { $slice: ['$images', 3] } } },
      ]).toArray();
      const galleryMap = new Map(galleryImages.map(g => [g._id, g.images]));

      // Fallback thumbnails
      const booksWithoutGallery = targetIds.filter(id => !galleryMap.has(id));
      let thumbMap = new Map<string, string>();
      if (booksWithoutGallery.length > 0) {
        const thumbnailPages = await db.collection('pages').find(
          { book_id: { $in: booksWithoutGallery }, page_number: 1, ...tenantFilter },
          { projection: { book_id: 1, thumbnail_blob: 1, image_thumb: 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }
        ).toArray();
        thumbMap = new Map(thumbnailPages.map(p => [p.book_id, p.archived_photo || p.cropped_photo || p.photo || p.thumbnail_blob]));
      }

      // Preserve the user's like order (most recent first)
      const items = targetIds
        .map(id => {
          const book = booksMap.get(id);
          if (!book) return null;
          const gallery = galleryMap.get(book.id) || [];
          return {
            id: book.id,
            // The favorites page builds /artwork/<slug || id> hrefs from this.
            // /popular already returns slug; without it here every artwork in
            // "My Likes" linked to /artwork/<id>, which used to 404.
            slug: book.slug,
            title: book.display_title || book.title,
            author: book.author,
            year: book.year,
            published: book.published,
            language: book.language,
            thumbnail: book.cover_image || thumbMap.get(book.id) || book.thumbnail_blob,
            featured_images: gallery,
            likeCount: countMap.get(id) || 1,
            contentType: book.content_type === 'artwork' ? ('artwork' as const) : ('book' as const),
          };
        })
        .filter(Boolean);

      return NextResponse.json({ items, total: items.length });
    }

    if (targetType === 'page') {
      const pagesData = await db.collection('pages').find(
        { id: { $in: targetIds }, ...tenantFilter },
        { projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1, thumbnail_blob: 1, image_thumb: 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }
      ).toArray();
      const pagesMap = new Map(pagesData.map(p => [p.id, p]));

      const bookIds = [...new Set(pagesData.map(p => p.book_id))];
      const booksData = await db.collection('books').find(
        { id: { $in: bookIds }, ...tenantFilter },
        { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      const items = targetIds
        .map(id => {
          const page = pagesMap.get(id);
          if (!page) return null;
          const book = booksMap.get(page.book_id);
          const rawText = page.translation?.data || page.ocr?.data || '';
          const text = stripEditorialWrappers(rawText).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          return {
            id: page.id,
            pageNumber: page.page_number,
            bookId: page.book_id,
            bookTitle: book ? (book.display_title || book.title) : 'Unknown',
            bookAuthor: book?.author,
            bookYear: book?.year,
            thumbnail: page.thumbnail_blob || page.archived_photo || page.cropped_photo || page.photo,
            // Full-resolution source (no 150px thumbnail first) — used as the
            // crop source by the profile-photo picker, where a thumbnail
            // upscaled to 512px turns to mush.
            image_full: page.archived_photo || page.cropped_photo || page.photo || page.thumbnail_blob,
            excerpt: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
            likeCount: countMap.get(id) || 1,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ items, total: items.length });
    }

    if (targetType === 'image') {
      const parsedItems = targetIds.map(id => {
        const match = id.match(/^(.+)[:\-](\d+)$/);
        const pageId = match?.[1] ?? id;
        const detectionIndex = match ? parseInt(match[2]) : 0;
        return { galleryImageId: id, pageId, detectionIndex };
      });

      const pageIds = [...new Set(parsedItems.map(p => p.pageId))];
      const pagesData = await db.collection('pages').find(
        { id: { $in: pageIds }, ...tenantFilter },
        { projection: { id: 1, book_id: 1, page_number: 1, photo_original: 1, cropped_photo: 1, archived_photo: 1, detected_images: 1 } }
      ).toArray();
      const pagesMap = new Map(pagesData.map(p => [p.id, p]));

      const bookIds = [...new Set(pagesData.map(p => p.book_id))];
      const booksData = await db.collection('books').find(
        { id: { $in: bookIds }, ...tenantFilter },
        { projection: { id: 1, title: 1, author: 1, year: 1 } }
      ).toArray();
      const booksMap = new Map(booksData.map(b => [b.id, b]));

      const items = parsedItems
        .map(item => {
          const page = pagesMap.get(item.pageId);
          if (!page || !page.detected_images?.[item.detectionIndex]) return null;
          const detection = page.detected_images[item.detectionIndex];
          const book = booksMap.get(page.book_id);
          if (!book) return null;

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

          return {
            galleryImageId: item.galleryImageId,
            pageId: item.pageId,
            detectionIndex: item.detectionIndex,
            likeCount: countMap.get(item.galleryImageId) || 1,
            description: detection.description || '',
            type: detection.type || 'illustration',
            museumDescription: detection.museum_description,
            croppedUrl,
            bookId: book.id,
            bookTitle: book.title,
            bookAuthor: book.author,
            bookYear: book.year,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ items, total: items.length });
    }

    return NextResponse.json({ items: [], total: 0 });
  } catch (error) {
    console.error('Error getting my likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
