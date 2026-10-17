import { NextResponse } from 'next/server';
import { parseCatalogFilters, parseCatalogState } from '@/lib/catalog/filters';
import { browseCatalog } from '@/lib/catalog/query';

export const maxDuration = 15;

/**
 * GET /api/catalog/results — the catalogue page's book list.
 *
 * Reads the same wire format the page writes (src/lib/catalog/filters.ts):
 * q, also[], title, author, not, language[], category, collection,
 * year_min, year_max, has_translation, first_translation, sort, page, limit;
 * and `id` (repeated, up to 120) for the catalogue's own records of the works
 * an asked search found.
 * `/api/catalog/browse` keeps its narrower contract for /catalog/scholar.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const state = parseCatalogState(sp);
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const limit = Math.min(120, Math.max(1, parseInt(sp.get('limit') || '48', 10) || 48));
  try {
    const result = await browseCatalog(parseCatalogFilters(sp), state.sort, page, limit);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[catalog/results]', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to load the catalogue' }, { status: 500 });
  }
}
