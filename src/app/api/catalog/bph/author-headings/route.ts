import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { applyBphFilters, readBphFilters } from '@/lib/bph-catalog-filters';
import { authorSearchTerms, matchingAuthorHeadings } from '@/lib/bph-catalog-author-headings';

export const dynamic = 'force-dynamic';

// Enough to rank headings: the largest author in the catalogue holds a few hundred works.
const SAMPLE_ROWS = 1000;
const CAPS = { mode: 'new', hasNormalizedColumns: true, hasFirstTranslationColumn: true } as const;

/**
 * Author headings for the catalogue's search box, called with the same query
 * string as the search. Each count is what clicking the heading will show under
 * the filters the reader has on. A heading that finds nothing is left out. Read-only.
 */
export async function GET(req: NextRequest) {
  const filters = readBphFilters(req.nextUrl.searchParams);
  const terms = authorSearchTerms(filters.q);
  const cached = { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } };
  if (terms.length === 0 || filters.author) return NextResponse.json({ headings: [] }, cached);

  try {
    const base = supabase.from('bph_works').select('author');
    let sample = applyBphFilters(base, { ...filters, q: '' }, CAPS);
    for (const term of terms) sample = sample.ilike('author_norm', `%${term}%`);
    const { data, error } = await sample.limit(SAMPLE_ROWS);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Array<{ author: string | null }>;
    const candidates = matchingAuthorHeadings(rows.map((row) => row.author), terms);
    const headings = await Promise.all(
      candidates.map(async (author) => {
        const base = supabase.from('bph_works').select('uuid', { count: 'exact', head: true });
        const result = await applyBphFilters(base, { ...filters, q: '', author }, CAPS);
        if (result.error) throw new Error(result.error.message);
        return { author, total: result.count ?? 0 };
      }),
    );
    return NextResponse.json({ headings: headings.filter((h) => h.total > 0) }, cached);
  } catch (err) {
    // A failure costs the reader a hint, not the search. Never cached.
    console.error('[catalog/bph/author-headings]', err);
    return NextResponse.json({ headings: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
