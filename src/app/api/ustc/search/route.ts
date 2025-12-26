import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// USTC enriched database - 500k+ Renaissance books with English translations
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Query enriched USTC table
    const searchUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
    searchUrl.searchParams.set('select', 'id,std_title,english_title,original_language,detected_language,work_type,original_author,subject_tags,religious_tradition,classical_source');
    searchUrl.searchParams.set('limit', '15');

    // Check if query is a USTC ID (numeric)
    if (/^\d+$/.test(query)) {
      searchUrl.searchParams.set('id', `eq.${query}`);
    } else {
      // Search in both original and English titles, plus original_author
      searchUrl.searchParams.set('or', `(std_title.ilike.*${query}*,english_title.ilike.*${query}*,original_author.ilike.*${query}*)`);
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      console.error('USTC search error:', await response.text());
      return NextResponse.json({ results: [], error: 'Search failed' });
    }

    const data = await response.json();

    // Map to our expected format
    const results = data.map((row: Record<string, unknown>) => ({
      id: String(row.id || ''),
      title: String(row.std_title || ''),
      englishTitle: row.english_title ? String(row.english_title) : undefined,
      author: row.original_author ? String(row.original_author) : undefined,
      language: row.detected_language ? String(row.detected_language) : (row.original_language ? String(row.original_language) : undefined),
      workType: row.work_type ? String(row.work_type) : undefined,
      subjectTags: row.subject_tags as string[] | undefined,
      religiousTradition: row.religious_tradition ? String(row.religious_tradition) : undefined,
      classicalSource: row.classical_source ? String(row.classical_source) : undefined,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error('USTC search error:', error);
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 });
  }
}
