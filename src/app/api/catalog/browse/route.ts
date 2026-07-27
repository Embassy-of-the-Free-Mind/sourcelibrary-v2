import { NextResponse } from 'next/server';
import { browseBooks, getLanguageCounts, type SortOption } from '@/lib/books-catalog';

export const maxDuration = 15;

const VALID_SORTS = new Set<SortOption>([
  'popular', 'recent', 'last_translated', 'title', 'author', 'year_asc', 'year_desc',
]);

/**
 * GET /api/catalog/browse
 *
 * Server-side paginated catalog browse powered by Supabase books_catalog.
 * Replaces the old MongoDB snapshot approach.
 *
 * Query params: sort, language, q, page, limit
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sortRaw = searchParams.get('sort') || 'popular';
    const sort: SortOption = VALID_SORTS.has(sortRaw as SortOption) ? (sortRaw as SortOption) : 'popular';
    const language = searchParams.get('language') || undefined;
    const search = searchParams.get('q') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(120, Math.max(1, parseInt(searchParams.get('limit') || '60', 10)));
    const offset = (page - 1) * limit;
    const includeLangs = searchParams.get('langs') === '1';

    // Additional filters
    const yearMin = searchParams.get('year_min') ? parseInt(searchParams.get('year_min')!, 10) : undefined;
    const yearMax = searchParams.get('year_max') ? parseInt(searchParams.get('year_max')!, 10) : undefined;
    const firstTranslation = searchParams.get('first_translation') === '1' || undefined;
    const hasTranslation = searchParams.get('has_translation') === '1' || undefined;
    const category = searchParams.get('category') || undefined;
    const collection = searchParams.get('collection') || undefined;

    const promises: [Promise<{ books: unknown[]; total: number }>, Promise<{ lang: string; count: number }[]> | null] = [
      browseBooks({ language, search, sort, offset, limit, exactCount: true, yearMin, yearMax, firstTranslation, hasTranslation, category, collection }),
      includeLangs ? getLanguageCounts({ collection }) : null,
    ];

    const [result, languages] = await Promise.all([
      promises[0],
      promises[1] || Promise.resolve(null),
    ]);

    return NextResponse.json(
      { books: result.books, total: result.total, ...(languages ? { languages } : {}) },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } },
    );
  } catch (err) {
    console.error('Catalog browse error:', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}
