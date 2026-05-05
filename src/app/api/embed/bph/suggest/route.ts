import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { searchBookIds } from '@/lib/books-catalog';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/suggest?q=alch
 *
 * Autocomplete/typeahead for BPH book search.
 * Returns up to 8 matching books with minimal data for fast dropdown rendering.
 *
 * Query params:
 *   q - search prefix (min 2 chars)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';

    if (q.length < 2) {
      return NextResponse.json({ suggestions: [] }, { headers: CORS_HEADERS });
    }

    // Get matching book IDs from Supabase trigram search
    const matchedIds = await searchBookIds(q, { limit: 50 });
    if (matchedIds.length === 0) {
      return NextResponse.json({ suggestions: [] }, { headers: CORS_HEADERS });
    }

    // Filter to BPH books and return minimal data
    const db = await getReadDb();
    const books = await db.collection('books')
      .find({
        id: { $in: matchedIds },
        held_by: 'bph',
        visible: true,
        pages_count: { $gt: 0 },
      })
      .project({
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
        author: 1, language: 1, published: 1,
        thumbnail_blob: 1, thumbnail: 1, image_display: 1, image_thumb: 1,
      })
      .limit(8)
      .maxTimeMS(5000)
      .toArray();

    // Preserve search relevance order
    const idOrder = new Map(matchedIds.map((id, i) => [id, i]));
    books.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

    const suggestions = books.map(b => ({
      slug: b.slug || b.id,
      title: b.display_title || b.title,
      author: b.author,
      language: b.language,
      published: b.published,
      thumbnail: b.image_thumb || b.image_display || b.thumbnail_blob || b.thumbnail,
    }));

    return NextResponse.json({ suggestions }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH suggest error:', error);
    return NextResponse.json({ suggestions: [] }, { headers: CORS_HEADERS });
  }
}
