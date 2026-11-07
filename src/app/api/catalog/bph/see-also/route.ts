import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { applyBphFilters, readBphFilters } from '@/lib/bph-catalog-filters';
import { bphSeeAlsoQueries } from '@/lib/bph-catalog-see-also';

export const dynamic = 'force-dynamic';

/**
 * Counts for the catalogue's see-also line. The browser calls this only when the
 * search holds a word on the variant list, with the same query string as the
 * search, so each count is true under the filters the reader has on. A variant
 * that finds nothing is left out. Read-only.
 */
export async function GET(req: NextRequest) {
  const filters = readBphFilters(req.nextUrl.searchParams);

  try {
    const results = await Promise.all(
      bphSeeAlsoQueries(filters.q).map(async (query) => {
        const base = supabase.from('bph_works').select('uuid', { count: 'exact', head: true });
        const { count, error } = await applyBphFilters(
          base,
          { ...filters, q: query },
          { mode: 'new', hasNormalizedColumns: true, hasFirstTranslationColumn: true },
        );
        if (error) throw new Error(error.message);
        return { query, total: count ?? 0 };
      }),
    );
    return NextResponse.json(
      { seeAlso: results.filter((r) => r.total > 0) },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } },
    );
  } catch (err) {
    // A failure costs the reader a hint, not the search. Never cached.
    console.error('[catalog/bph/see-also]', err);
    return NextResponse.json({ seeAlso: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
