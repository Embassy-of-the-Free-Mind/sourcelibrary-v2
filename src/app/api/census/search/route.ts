import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Translation Census Search API
 *
 * GET /api/census/search?q=ficino
 *   Search USTC editions and translation catalogs to answer:
 *   "Has this author/work been translated into English?"
 *
 * Returns USTC editions with translation status, plus matching catalog entries.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const language = searchParams.get('language');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [], total: 0 });
    }

    // Search in parallel: USTC enrichments (with English titles) + translation catalogs
    const [ustcResults, catalogResults] = await Promise.all([
      searchUstcEditions(query, language, limit),
      searchTranslationCatalogs(query),
    ]);

    // Build a set of translated author surnames from catalogs for cross-referencing
    const translatedSurnames = new Set(
      catalogResults.map(c => c.author_surname?.toLowerCase()).filter(Boolean)
    );

    // Merge: annotate USTC results with catalog matches
    const results = ustcResults.map(edition => {
      const surname = extractSurname(edition.author);
      const hasKnownTranslation = edition.has_english_translation ||
        translatedSurnames.has(surname?.toLowerCase() || '');

      // Find specific catalog matches for this author
      const catalogMatches = surname
        ? catalogResults.filter(c =>
            c.author_surname?.toLowerCase() === surname.toLowerCase()
          )
        : [];

      return {
        ...edition,
        translation_status: hasKnownTranslation ? 'translated' : 'untranslated',
        catalog_matches: catalogMatches.slice(0, 5),
      };
    });

    return NextResponse.json({
      results,
      catalog_entries: catalogResults.length,
      total: results.length,
      query,
    });
  } catch (err) {
    console.error('Census search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function searchUstcEditions(query: string, language: string | null, limit: number) {
  // Search enrichments first (have English titles), then raw editions
  const enrichQuery = supabase
    .from('ustc_enrichments')
    .select('id, std_title, english_title, original_author, detected_language, work_type')
    .or(`std_title.ilike.%${query}%,english_title.ilike.%${query}%,original_author.ilike.%${query}%`)
    .limit(limit);

  const { data: enriched } = await enrichQuery;

  if (enriched && enriched.length > 0) {
    // Get the full edition data for these IDs
    const ids = enriched.map(e => e.id);
    const { data: editions } = await supabase
      .from('ustc_editions')
      .select('id, sn, title, author_1, year, language_1, place, has_iiif_scan, has_english_translation, in_source_library')
      .in('id', ids);

    const editionMap = new Map((editions || []).map(e => [e.id, e]));

    return enriched.map(e => {
      const ed = editionMap.get(e.id);
      return {
        ustc_id: ed?.sn || e.id,
        title: e.std_title || ed?.title || '',
        english_title: e.english_title || null,
        author: e.original_author || ed?.author_1 || '',
        year: ed?.year || null,
        language: e.detected_language || ed?.language_1 || '',
        place: ed?.place || '',
        has_iiif_scan: ed?.has_iiif_scan || false,
        has_english_translation: ed?.has_english_translation || false,
        in_source_library: ed?.in_source_library || false,
        work_type: e.work_type || null,
      };
    });
  }

  // Fallback: search raw editions by author
  const { data: editions } = await supabase
    .from('ustc_editions')
    .select('id, sn, title, author_1, year, language_1, place, has_iiif_scan, has_english_translation, in_source_library')
    .ilike('author_1', `%${query}%`)
    .limit(limit);

  return (editions || []).map(ed => ({
    ustc_id: ed.sn || ed.id,
    title: ed.title || '',
    english_title: null,
    author: ed.author_1 || '',
    year: ed.year || null,
    language: ed.language_1 || '',
    place: ed.place || '',
    has_iiif_scan: ed.has_iiif_scan || false,
    has_english_translation: ed.has_english_translation || false,
    in_source_library: ed.in_source_library || false,
    work_type: null,
  }));
}

async function searchTranslationCatalogs(query: string) {
  try {
    const db = await getDb();
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    if (words.length === 0) return [];

    // Search by canonical author/work fields (indexed)
    const conditions = words.map(word => ({
      $or: [
        { canonical_author_normalized: { $regex: word, $options: 'i' } },
        { canonical_work_normalized: { $regex: word, $options: 'i' } },
        { english_title: { $regex: word, $options: 'i' } },
        { author_surname: { $regex: word, $options: 'i' } },
      ]
    }));

    const results = await db.collection('translation_catalogs')
      .find({ $and: conditions })
      .project({
        source: 1,
        author: 1,
        author_surname: 1,
        english_title: 1,
        original_title: 1,
        translator: 1,
        pub_year: 1,
        publisher: 1,
        series: 1,
        completeness: 1,
      })
      .limit(50)
      .toArray();

    return results;
  } catch {
    return [];
  }
}

function extractSurname(author: string | null | undefined): string | null {
  if (!author) return null;
  // USTC format: "Surname, Given" or just "Surname"
  const comma = author.indexOf(',');
  if (comma > 0) return author.substring(0, comma).trim();
  return author.split(/\s+/)[0]?.trim() || null;
}
