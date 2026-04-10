import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { browseBooks, type SortOption } from '@/lib/books-catalog';

export const maxDuration = 30;

/**
 * GET /api/collections/[id]
 *
 * Get collection metadata and its books with pagination/sorting.
 * Books are served from Supabase (fast) with MongoDB fallback.
 *
 * Query params:
 *   - mode: 'manifest' returns lightweight data for all books (client-side filter/sort)
 *   - sort: 'year_asc' (default), 'year_desc', 'title', 'author', 'recent', 'popular', 'relevance'
 *   - language: filter by language
 *   - q: search query (title/author)
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

    // Get collection metadata from MongoDB (small doc, fast)
    const collection = await db.collection('collections').findOne({ slug: id });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    const isArtCollection = collection.collection_type === 'visual_art';
    // Show all books (not just translated) for art collections or collections with few translated books
    const skipTranslationFilter = isArtCollection || collection.show_all_books === true;
    const { _id, ...collectionClean } = collection;

    // Map API sort params to Supabase sort options
    const sortMap: Record<string, SortOption> = {
      year_asc: 'year_asc',
      year_desc: 'year_desc',
      title: 'title',
      author: 'author',
      recent: 'recent',
      last_translated: 'last_translated',
      popular: 'popular',
      relevance: 'quality', // collection_scores not in Supabase; quality_score is closest proxy
    };
    const sbSort = sortMap[sort] || 'year_asc';

    // Manifest mode: return all books for client-side filter/sort
    if (mode === 'manifest') {
      const { books: sbBooks, total } = await browseBooks({
        collection: id,
        hasTranslation: !skipTranslationFilter,
        sort: sbSort,
        limit: 1000, // manifest wants everything
      });

      const books = sbBooks.map(b => ({
        id: b.id, slug: b.slug, title: b.title, display_title: b.display_title,
        author: b.author, year: b.year, language: b.language,
        pages_count: b.pages_count, pages_ocr: b.pages_ocr,
        pages_translated: b.pages_translated, pages_blank: b.pages_blank,
        published: b.published, read_count: b.read_count,
        thumbnail: b.thumbnail, thumbnail_blob: b.thumbnail_blob,
        is_first_translation: b.is_first_translation,
        created_at: null, last_translation_at: null,
        resource_type: null, medium: null, enrichment: null,
        relevance: b.quality_score || 0,
      }));

      return NextResponse.json({ books, total });
    }

    // Standard paginated query via Supabase
    const { books: sbBooks, total } = await browseBooks({
      collection: id,
      hasTranslation: !skipTranslationFilter,
      language: language || undefined,
      search: q || undefined,
      sort: sbSort,
      offset,
      limit,
    });

    const books = sbBooks.map(b => ({
      id: b.id, slug: b.slug, title: b.title, display_title: b.display_title,
      author: b.author, year: b.year, language: b.language,
      pages_count: b.pages_count, pages_ocr: b.pages_ocr,
      pages_translated: b.pages_translated, pages_blank: b.pages_blank,
      photo: b.photo, categories: b.categories,
      thumbnail: b.thumbnail, thumbnail_blob: b.thumbnail_blob,
      published: b.published, read_count: b.read_count,
      is_first_translation: b.is_first_translation,
    }));

    // Highlights: top 5 by quality score
    const { books: highlightBooks } = await browseBooks({
      collection: id,
      hasTranslation: !skipTranslationFilter,
      sort: 'quality',
      limit: 5,
    });

    const highlights = highlightBooks.map(b => ({
      id: b.id, slug: b.slug, title: b.title, display_title: b.display_title,
      author: b.author, year: b.year, language: b.language,
      pages_count: b.pages_count, pages_ocr: b.pages_ocr,
      pages_translated: b.pages_translated, pages_blank: b.pages_blank,
      photo: b.photo, categories: b.categories,
      thumbnail: b.thumbnail, thumbnail_blob: b.thumbnail_blob,
      published: b.published, read_count: b.read_count,
      is_first_translation: b.is_first_translation,
      quality_score: b.quality_score,
    }));

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
