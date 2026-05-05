import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { searchBookIds } from '@/lib/books-catalog';

export const maxDuration = 15;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/books
 *
 * Paginated BPH catalogue with optional search.
 *
 * Query params:
 *   q          - search query (min 2 chars)
 *   limit      - results per page (default 24, max 100)
 *   offset     - pagination offset (default 0)
 *   sort       - title | date_asc | date_desc | recent (default: title)
 *   language   - filter by original language
 *   category   - filter by collection/category slug
 *   year_from  - min publication year
 *   year_to    - max publication year
 *   translated - "true" to show only books with translations
 *
 * Returns: { books: [...], total, limit, offset }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const sort = searchParams.get('sort') || 'title';
    const language = searchParams.get('language');
    const category = searchParams.get('category');
    const yearFrom = searchParams.get('year_from');
    const yearTo = searchParams.get('year_to');
    const translated = searchParams.get('translated');

    const db = await getReadDb();
    const books = db.collection('books');

    // Base BPH filter
    const filter: Record<string, unknown> = {
      held_by: 'bph',
      visible: true,
      pages_count: { $gt: 0 },
    };

    if (language) filter.language = language;
    if (category) filter.categories = category;
    if (translated === 'true') filter.pages_translated = { $gt: 0 };

    if (yearFrom || yearTo) {
      const yearFilter: Record<string, number> = {};
      if (yearFrom) { const n = parseInt(yearFrom); if (!isNaN(n)) yearFilter.$gte = n; }
      if (yearTo) { const n = parseInt(yearTo); if (!isNaN(n)) yearFilter.$lte = n; }
      if (Object.keys(yearFilter).length) filter.year = yearFilter;
    }

    // If search query, use Supabase trigram search to get matching IDs
    // then intersect with BPH filter in MongoDB
    let searchIds: string[] | null = null;
    if (query.length >= 2) {
      searchIds = await searchBookIds(query, { limit: 500 });
      if (searchIds.length === 0) {
        return NextResponse.json({ books: [], total: 0, limit, offset }, { headers: CORS_HEADERS });
      }
      filter.id = { $in: searchIds };
    }

    // Sort order
    let sortSpec: Record<string, 1 | -1> = { title: 1 };
    switch (sort) {
      case 'date_asc': sortSpec = { year: 1, title: 1 }; break;
      case 'date_desc': sortSpec = { year: -1, title: 1 }; break;
      case 'recent': sortSpec = { createdAt: -1 }; break;
      default: sortSpec = { title: 1 };
    }

    const projection = {
      _id: 0,
      id: 1,
      slug: 1,
      title: 1,
      display_title: 1,
      author: 1,
      language: 1,
      published: 1,
      year: 1,
      pages_count: 1,
      pages_translated: 1,
      thumbnail: 1, image_display: 1,
      thumbnail_blob: 1, image_thumb: 1,
      categories: 1,
      'dublin_core.dc_source': 1,
    };

    const [results, total] = await Promise.all([
      books.find(filter).project(projection).sort(sortSpec).skip(offset).limit(limit).maxTimeMS(8000).toArray(),
      books.countDocuments(filter),
    ]);

    // If search had specific ordering, preserve it
    let finalResults = results;
    if (searchIds && sort === 'title') {
      // Preserve search relevance order
      const idOrder = new Map(searchIds.map((id, i) => [id, i]));
      finalResults = results.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
    }

    const cleaned = finalResults.map(book => ({
      id: book.id,
      slug: book.slug || book.id,
      title: book.title,
      display_title: book.display_title,
      author: book.author,
      language: book.language,
      published: book.published,
      year: book.year,
      pages_count: book.pages_count,
      pages_translated: book.pages_translated || 0,
      thumbnail: book.image_thumb || book.image_display || book.thumbnail_blob || book.thumbnail,
      catalogue_number: book.dublin_core?.dc_source || null,
      categories: book.categories || [],
      url: `/book/${book.slug || book.id}`,
    }));

    return NextResponse.json({ books: cleaned, total, limit, offset }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH books error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
