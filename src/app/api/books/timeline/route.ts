import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const decade = searchParams.get('decade');
    const language = searchParams.get('language') || '';
    const collection = searchParams.get('collection') || '';
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!tenantId) {
      return NextResponse.json({ books: [], timeline: [] });
    }

    const db = await getReadDb();

    // Base filter: has year, not hidden
    const baseMatch: Record<string, unknown> = {
      tenantId,
      year: { $exists: true, $ne: null },
      visible: true,
      pages_count: { $gt: 0 },
    };
    if (language) baseMatch.language = language;
    if (collection) baseMatch.categories = collection;

    // Drill-down mode: return books or art for a specific decade
    if (decade) {
      const decadeNum = parseInt(decade);
      if (isNaN(decadeNum)) {
        return NextResponse.json({ error: 'Invalid decade' }, { status: 400 });
      }

      const mode = searchParams.get('mode') || 'books';
      const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
      const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

      // Art mode: one best image per author from gallery_images
      if (mode === 'art') {
        const artMatch: Record<string, unknown> = {
          book_year: { $gte: decadeNum, $lt: decadeNum + 10 },
          book_visible: true,
          gallery_quality: { $gte: 0.6 },
        };

        // Aggregate: group by author, pick the best image per author
        const artPipeline = [
          { $match: artMatch },
          { $sort: { gallery_quality: -1 as const } },
          {
            $group: {
              _id: '$book_author',
              doc: { $first: '$$ROOT' },
            },
          },
          { $replaceRoot: { newRoot: '$doc' } },
          { $sort: { book_year: 1 as const, gallery_quality: -1 as const } },
          { $skip: offset },
          { $limit: limit },
        ];

        const countPipeline = [
          { $match: artMatch },
          { $group: { _id: '$book_author' } },
          { $count: 'total' },
        ];

        const [artItems, countResult] = await Promise.all([
          db.collection('gallery_images').aggregate(artPipeline, { maxTimeMS: 10000 }).toArray(),
          db.collection('gallery_images').aggregate(countPipeline, { maxTimeMS: 10000 }).toArray(),
        ]);

        const total = countResult[0]?.total || 0;

        const mapped = artItems.map(item => ({
          id: item.id || `${item.page_id}-${item.detection_index}`,
          imageUrl: item.image_url,
          thumbnailUrl: item.thumbnail_url,
          extractedUrl: item.extracted_url,
          description: item.description,
          museumDescription: item.museum_description,
          type: item.type,
          author: item.book_author || 'Unknown',
          bookTitle: item.book_title,
          bookId: item.book_id,
          bookSlug: item.book_slug,
          year: item.book_year,
          pageId: item.page_id,
          detectionIndex: item.detection_index,
          galleryQuality: item.gallery_quality,
        }));

        return NextResponse.json({ decade: decadeNum, art: mapped, total, offset, mode: 'art' }, {
          headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
        });
      }

      // Books mode (default)
      const decadeMatch = {
        ...baseMatch,
        year: { $gte: decadeNum, $lt: decadeNum + 10 },
      };

      const [books, total] = await Promise.all([
        db.collection('books')
          .find(decadeMatch)
          .project({
            id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
            language: 1, thumbnail_blob: 1, thumbnail: 1, image_display: 1, image_thumb: 1,
            pages_count: 1, pages_translated: 1, published: 1,
          })
          .sort({ year: 1, title: 1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        db.collection('books').countDocuments(decadeMatch),
      ]);

      const mapped = books.map(b => ({
        id: b.id,
        slug: b.slug,
        title: b.display_title || b.title,
        display_title: b.display_title,
        author: b.author,
        year: b.year,
        language: b.language,
        thumbnail: b.thumbnail,
        thumbnail_blob: b.thumbnail_blob,
        pages_count: b.pages_count,
        pages_translated: b.pages_translated,
        published: b.published,
      }));

      return NextResponse.json({ decade: decadeNum, books: mapped, total, offset }, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    // Overview mode — read pre-computed snapshot from system_config.
    // Live aggregation is extremely slow on slow networks and is disabled.
    const cached = await db.collection('system_config')
      .findOne({ _id: 'timeline_overview' } as any)
      .catch(() => null);

    if (cached?.data) {
      return NextResponse.json(cached.data, {
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    return NextResponse.json(
      { error: 'Timeline overview not precomputed' },
      { status: 503 },
    );
  } catch (error) {
    console.error('Timeline API error:', error);
    return NextResponse.json({ error: 'Failed to fetch timeline data' }, { status: 500 });
  }
}
