import { NextRequest, NextResponse } from 'next/server';
import { searchBiblissima } from '@/lib/biblissima';

export const maxDuration = 60;

/**
 * GET /api/search/biblissima?q=hermetica&language=Latin&from=0&limit=20
 *
 * Search Biblissima IIIF Collections (40+ European libraries, pre-1800 MSS).
 * Returns structured results with IIIF manifest URLs ready for /api/import/iiif.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const q = params.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required (min 2 characters)' },
      { status: 400 }
    );
  }

  const limit = Math.min(
    Math.max(parseInt(params.get('limit') || '20', 10) || 20, 1),
    100
  );
  const from = Math.max(parseInt(params.get('from') || '0', 10) || 0, 0);

  try {
    const response = await searchBiblissima({
      q,
      language: params.get('language') || undefined,
      collection: params.get('collection') || undefined,
      library: params.get('library') || undefined,
      location: params.get('location') || undefined,
      from,
      limit,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Biblissima search error:', error);
    return NextResponse.json(
      {
        error: 'Failed to search Biblissima',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    );
  }
}
