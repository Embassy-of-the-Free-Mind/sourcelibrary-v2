import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/books/browse — Browse/filter books via Supabase
 *
 * Drop-in replacement for /api/books/library (MongoDB) for non-search queries.
 * Falls back to /api/books/library when a text search is needed (Atlas Search).
 *
 * Query params: same as /api/books/library
 *   limit, skip, language, category, collection, library,
 *   first_translation, has_translation, sort
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200);
  const skip = Math.max(parseInt(searchParams.get('skip') || '0'), 0);
  const search = searchParams.get('search') || '';
  const language = searchParams.get('language') || '';
  const category = searchParams.get('category') || '';
  const collection = searchParams.get('collection') || '';
  const library = searchParams.get('library') || '';
  const firstTranslation = searchParams.get('first_translation') === 'true';
  const hasTranslation = searchParams.get('has_translation') === 'true';
  const sort = searchParams.get('sort') || 'recent-translation';

  // Text search still needs Atlas Search — redirect to the MongoDB endpoint
  if (search.trim()) {
    const url = new URL('/api/books/library', request.url);
    url.search = searchParams.toString();
    return NextResponse.redirect(url, 307);
  }

  try {
    // Build query
    let query = supabase
      .from('books_catalog')
      .select('id, slug, title, display_title, author, thumbnail, thumbnail_blob, language, published, pages_count, pages_ocr, pages_translated, is_first_translation, last_translation_at, quality_score, image_source_provider', { count: 'exact' })
      .eq('visible', true)
      .gt('pages_count', 0);

    // Filters
    if (language) query = query.eq('language', language);
    if (category) query = query.contains('categories', [category]);
    if (collection) query = query.contains('collections', [collection]);
    if (library) query = query.eq('image_source_provider', library);
    if (firstTranslation) query = query.eq('is_first_translation', true);
    if (hasTranslation) query = query.gt('pages_translated', 0);

    // Sort
    switch (sort) {
      case 'title-asc':
        query = query.order('sort_title', { ascending: true });
        break;
      case 'title-desc':
        query = query.order('sort_title', { ascending: false });
        break;
      case 'date_asc':
        query = query.order('year', { ascending: true, nullsFirst: false });
        break;
      case 'date_desc':
        query = query.order('year', { ascending: false, nullsFirst: false });
        break;
      case 'recent':
        query = query.order('last_processed', { ascending: false, nullsFirst: false });
        break;
      case 'recent-translation':
      default:
        query = query.order('quality_score', { ascending: false }).order('last_translation_at', { ascending: false, nullsFirst: false });
        break;
    }

    // Pagination
    query = query.range(skip, skip + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error('[books/browse] Supabase error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform to match /api/books/library response shape
    const books = (data || []).map(book => ({
      ...book,
      translation_percent: book.pages_count > 0
        ? Math.round((book.pages_translated / book.pages_count) * 100)
        : 0,
    }));

    return NextResponse.json(
      { books, total: count || 0, skip, limit },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    console.error('[books/browse] Error:', error);
    return NextResponse.json({ error: 'Browse failed' }, { status: 500 });
  }
}
