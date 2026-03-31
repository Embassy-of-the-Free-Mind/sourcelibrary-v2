import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

/**
 * GET /api/collections/[id]
 *
 * Get collection metadata and its books with pagination/sorting.
 *
 * Query params:
 *   - mode: 'manifest' returns lightweight data for all books (client-side filter/sort)
 *   - sort: 'year_asc' (default), 'year_desc', 'title', 'author', 'recent', 'popular', 'relevance'
 *   - language: filter by language
 *   - limit: max results (default 60, max 200)
 *   - offset: pagination offset
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    const sort = searchParams.get('sort') || 'year_asc';
    const language = searchParams.get('language');
    const q = searchParams.get('q')?.trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '60'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    // Get collection metadata (slug stored as "slug" field)
    const collection = await db.collection('collections').findOne({ slug: id });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // Art collections bypass hidden/translation filters since artworks are hidden: true
    // and have no translated pages
    const isArtCollection = collection.collection_type === 'visual_art';

    const filter: Record<string, unknown> = isArtCollection
      ? { collections: id, resource_type: { $exists: true } }
      : {
          collections: id,
          visible: true,
          pages_count: { $gt: 0 },
          pages_translated: { $gt: 0 },
        };

    // Manifest mode: return lightweight data for all books in one shot.
    // Enables instant client-side search/sort/filter. ~50-100KB for 2,000 books.
    if (mode === 'manifest') {
      const manifestProjection = {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
        language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
        published: 1, read_count: 1, thumbnail: 1, thumbnail_blob: 1,
        is_first_translation: 1, ft_disposition: 1,
        created_at: 1, last_translation_at: 1,
      };
      // Include relevance score for this collection
      const manifestProjectionWithScore = {
        ...manifestProjection,
        [`collection_scores.${id}.relevance`]: 1,
      };
      const allBooks = await db.collection('books')
        .find(filter, { projection: manifestProjectionWithScore })
        .sort({ published: 1 })
        .toArray();

      // Flatten relevance score to top level
      const books = allBooks.map(({ collection_scores, ...rest }) => ({
        ...rest,
        relevance: collection_scores?.[id]?.relevance ?? 0,
      }));

      return NextResponse.json({
        books,
        total: books.length,
      });
    }

    if (language) filter.language = language;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { display_title: { $regex: escaped, $options: 'i' } },
        { author: { $regex: escaped, $options: 'i' } },
      ];
    }

    // Sort — use 'published' for date sorts (artworks don't have 'year')
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      year_asc: { published: 1, title: 1 },
      year_desc: { published: -1, title: 1 },
      title: { title: 1 },
      author: { author: 1, title: 1 },
      recent: { created_at: -1 },
      last_translated: { last_translation_at: -1, title: 1 },
      popular: { read_count: -1, title: 1 },
      relevance: { [`collection_scores.${id}.relevance`]: -1, read_count: -1 },
    };
    const sortObj = sortMap[sort] || sortMap.year_asc;

    const projection = {
      _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
      language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1,
      photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
      resource_type: 1, is_first_translation: 1, ft_disposition: 1,
    };

    const highlightProjection = {
      ...projection,
      reading_summary: 1,
      read_count: 1,
      quality_score: 1,
    };

    const total = (q || language)
      ? await db.collection('books').countDocuments(filter)
      : (collection.book_count as number) || 0;

    const [books, highlights] = await Promise.all([
      db.collection('books')
        .find(filter, { projection })
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .toArray(),
      // Top 5: art collections use main filter; book collections prefer translated
      db.collection('books')
        .find(
          isArtCollection
            ? { collections: id, resource_type: { $exists: true } }
            : { collections: id, visible: true, pages_translated: { $gt: 0 } },
          { projection: highlightProjection },
        )
        .sort(isArtCollection ? { title: 1 } : { quality_score: -1, read_count: -1, pages_translated: -1 })
        .limit(5)
        .toArray(),
    ]);

    const { _id, ...collectionClean } = collection;

    return NextResponse.json({
      collection: collectionClean,
      books,
      highlights,
      total,
      limit,
      offset,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Collection detail error:', msg, error);
    return NextResponse.json(
      { error: 'Failed to fetch collection', detail: msg },
      { status: 500 }
    );
  }
}
