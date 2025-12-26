import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// USTC database - 1.6M+ Renaissance books (1450-1700)
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

interface UstcResult {
  id: string;
  title: string;
  englishTitle?: string;
  author?: string;
  language?: string;
  year?: string;
  place?: string;
  workType?: string;
  subjectTags?: string[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Search both enriched and full editions tables in parallel
    const isNumericId = /^\d+$/.test(query);

    // 1. Search enriched table (has English translations)
    const enrichedUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
    enrichedUrl.searchParams.set('select', 'id,std_title,english_title,original_language,detected_language,work_type,original_author,subject_tags');
    enrichedUrl.searchParams.set('limit', '10');
    if (isNumericId) {
      enrichedUrl.searchParams.set('id', `eq.${query}`);
    } else {
      enrichedUrl.searchParams.set('or', `(std_title.ilike.*${query}*,english_title.ilike.*${query}*,original_author.ilike.*${query}*)`);
    }

    // 2. Search full editions table (1.6M records, no English titles)
    const editionsUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
    editionsUrl.searchParams.set('select', 'id,title,author_1,language_1,year,place');
    editionsUrl.searchParams.set('limit', '10');
    if (isNumericId) {
      editionsUrl.searchParams.set('id', `eq.${query}`);
    } else {
      editionsUrl.searchParams.set('or', `(title.ilike.*${query}*,author_1.ilike.*${query}*)`);
    }

    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };

    const [enrichedRes, editionsRes] = await Promise.all([
      fetch(enrichedUrl.toString(), { headers }),
      fetch(editionsUrl.toString(), { headers }),
    ]);

    const enrichedData = enrichedRes.ok ? await enrichedRes.json() : [];
    const editionsData = editionsRes.ok ? await editionsRes.json() : [];

    // Map enriched results (with English titles)
    const enrichedResults: UstcResult[] = enrichedData.map((row: Record<string, unknown>) => ({
      id: String(row.id || ''),
      title: String(row.std_title || ''),
      englishTitle: row.english_title ? String(row.english_title) : undefined,
      author: row.original_author ? String(row.original_author) : undefined,
      language: row.detected_language ? String(row.detected_language) : (row.original_language ? String(row.original_language) : undefined),
      workType: row.work_type ? String(row.work_type) : undefined,
      subjectTags: row.subject_tags as string[] | undefined,
    }));

    // Map editions results (full database)
    const editionsResults: UstcResult[] = editionsData.map((row: Record<string, unknown>) => ({
      id: String(row.id || ''),
      title: String(row.title || ''),
      author: row.author_1 ? String(row.author_1) : undefined,
      language: row.language_1 ? String(row.language_1) : undefined,
      year: row.year ? String(row.year) : undefined,
      place: row.place ? String(row.place) : undefined,
    }));

    // Merge results, preferring enriched (has English titles), deduping by ID
    const seenIds = new Set<string>();
    const results: UstcResult[] = [];

    for (const r of enrichedResults) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        results.push(r);
      }
    }
    for (const r of editionsResults) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        results.push(r);
      }
    }

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error) {
    console.error('USTC search error:', error);
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 });
  }
}
