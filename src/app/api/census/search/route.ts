import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Translation Census Search API
 *
 * GET /api/census/search?q=ficino
 *   Search the translation census to answer:
 *   "Has this author/work been translated into English?"
 *
 * Primary: Supabase RPC search_translation_census (work-level, title-matched)
 * Fallback: direct ustc_enrichments + translation_catalogs query
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [], total: 0 });
    }

    // Try the census RPC first (uses materialized view with proper work-level matching)
    const { data: censusData, error: censusError } = await supabase.rpc(
      'search_translation_census',
      { query, max_results: limit }
    );

    if (!censusError && censusData) {
      const parsed = typeof censusData === 'string' ? JSON.parse(censusData) : censusData;
      if (parsed?.results?.length > 0) {
        return NextResponse.json({
          results: parsed.results.map((r: any) => ({
            title: r.std_title || r.ustc_english_title || '',
            english_title: r.ustc_english_title || null,
            author: r.author || r.author_surname || '',
            year: r.year || null,
            language: r.language || '',
            edition_count: r.edition_count || 1,
            translation_status: r.status,
            catalog_matches: r.status === 'translated' ? [{
              english_title: r.catalog_english_title || '',
              translator: r.translator || '',
              pub_year: r.translation_year || '',
              source: r.catalog_source || '',
              match_score: r.match_score || 0,
              completeness: r.completeness || 'unknown',
            }] : [],
          })),
          total: parsed.total || parsed.results.length,
          query,
          source: 'census_view',
        });
      }
    }

    // Fallback: direct search against ustc_enrichments
    return fallbackSearch(query, limit);
  } catch (err) {
    console.error('Census search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function fallbackSearch(query: string, limit: number) {
  const { data: enriched } = await supabase
    .from('ustc_enrichments')
    .select('id, std_title, english_title, original_author, detected_language, work_type')
    .or(`std_title.ilike.%${query}%,english_title.ilike.%${query}%,original_author.ilike.%${query}%`)
    .limit(limit);

  if (!enriched || enriched.length === 0) {
    return NextResponse.json({ results: [], total: 0, query, source: 'fallback' });
  }

  const ids = enriched.map(e => e.id);
  const { data: editions } = await supabase
    .from('ustc_editions')
    .select('id, sn, title, author_1, year, language_1, place, has_english_translation, in_source_library')
    .in('id', ids);

  const editionMap = new Map((editions || []).map(e => [e.id, e]));

  // Also search translation_catalogs in Supabase for matching catalog entries
  const { data: catalogs } = await supabase
    .from('translation_catalogs')
    .select('author_surname, english_title, translator, pub_year, source, completeness')
    .or(`author_surname.ilike.%${query}%,english_title.ilike.%${query}%`)
    .limit(50);

  const catalogBySurname = new Map<string, any[]>();
  for (const c of catalogs || []) {
    const key = c.author_surname?.toLowerCase() || '';
    if (!catalogBySurname.has(key)) catalogBySurname.set(key, []);
    catalogBySurname.get(key)!.push(c);
  }

  const results = enriched.map(e => {
    const ed = editionMap.get(e.id);
    const author = e.original_author || ed?.author_1 || '';
    const surname = extractSurname(author)?.toLowerCase() || '';
    const matches = catalogBySurname.get(surname) || [];

    return {
      title: e.std_title || ed?.title || '',
      english_title: e.english_title || null,
      author,
      year: ed?.year || null,
      language: e.detected_language || ed?.language_1 || '',
      edition_count: 1,
      translation_status: (ed?.has_english_translation || matches.length > 0) ? 'translated' : 'untranslated',
      catalog_matches: matches.slice(0, 3).map(m => ({
        english_title: m.english_title || '',
        translator: m.translator || '',
        pub_year: m.pub_year || '',
        source: m.source || '',
        completeness: m.completeness || 'unknown',
      })),
    };
  });

  return NextResponse.json({
    results,
    total: results.length,
    query,
    source: 'fallback',
  });
}

function extractSurname(author: string | null | undefined): string | null {
  if (!author) return null;
  const comma = author.indexOf(',');
  if (comma > 0) return author.substring(0, comma).trim();
  return author.split(/\s+/)[0]?.trim() || null;
}
