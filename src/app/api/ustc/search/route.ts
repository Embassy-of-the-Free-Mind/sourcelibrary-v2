import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// TODO: Connect to secondrenaissance Supabase for enriched USTC data
// Set these in .env.local:
// USTC_SUPABASE_URL=https://xxx.supabase.co
// USTC_SUPABASE_KEY=xxx

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const supabaseUrl = process.env.USTC_SUPABASE_URL;
    const supabaseKey = process.env.USTC_SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      // Return empty results if Supabase not configured
      console.log('USTC Supabase not configured - set USTC_SUPABASE_URL and USTC_SUPABASE_KEY');
      return NextResponse.json({
        results: [],
        message: 'USTC search not configured'
      });
    }

    // Query Supabase
    // Adjust the table name and column names based on your schema
    const tableName = 'ustc_editions'; // TODO: Update to your actual table name

    // Build the search query - using ilike for case-insensitive search
    const searchUrl = new URL(`${supabaseUrl}/rest/v1/${tableName}`);
    searchUrl.searchParams.set('select', 'id,title,author,language,year,place,printer');
    searchUrl.searchParams.set('limit', '10');

    // Check if query is a USTC ID (numeric)
    if (/^\d+$/.test(query)) {
      searchUrl.searchParams.set('id', `eq.${query}`);
    } else {
      // Search in title and author
      searchUrl.searchParams.set('or', `(title.ilike.*${query}*,author.ilike.*${query}*)`);
    }

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
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
      title: String(row.title || ''),
      author: row.author ? String(row.author) : undefined,
      language: row.language ? String(row.language) : undefined,
      year: row.year ? String(row.year) : undefined,
      place: row.place ? String(row.place) : undefined,
      printer: row.printer ? String(row.printer) : undefined,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error('USTC search error:', error);
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 });
  }
}
