import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 3600; // 1h cache

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/featured
 *
 * Returns featured/highlighted BPH books for homepage display.
 * Prioritizes: first translations > high quality scores > most read.
 *
 * Query params:
 *   limit - number of books (default 6, max 24)
 *   category - optional category filter
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '6'), 24);
    const category = searchParams.get('category');

    const db = await getReadDb();
    const filter: Record<string, unknown> = {
      held_by: 'bph',
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
    };
    if (category) filter.categories = category;

    const projection = {
      _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
      author: 1, editor: 1, language: 1, published: 1, year: 1,
      pages_count: 1, pages_translated: 1,
      thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
      is_first_translation: 1, quality_score: 1,
      read_count: 1, categories: 1,
      'reading_summary.overview': 1,
    };

    // First translations first, then by quality score, then by reads
    const books = await db.collection('books')
      .find(filter)
      .project(projection)
      .sort({ is_first_translation: -1, quality_score: -1, read_count: -1 })
      .limit(limit)
      .maxTimeMS(8000)
      .toArray();

    const cleaned = books.map(b => ({
      id: b.id,
      slug: b.slug || b.id,
      title: b.title,
      display_title: b.display_title,
      author: b.author,
      editor: b.editor || null,
      language: b.language,
      published: b.published,
      year: b.year,
      pages_count: b.pages_count,
      pages_translated: b.pages_translated || 0,
      thumbnail: b.image_thumb || b.image_display || b.thumbnail_blob || b.thumbnail,
      is_first_translation: b.is_first_translation || false,
      summary: b.reading_summary?.overview || null,
      categories: b.categories || [],
      url: `/book/${b.slug || b.id}`,
      reader_url: `https://bph.sourcelibrary.org/book/${b.slug || b.id}`,
    }));

    return NextResponse.json({ books: cleaned }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH featured error:', error);
    return NextResponse.json({ error: 'Failed to fetch featured books' }, { status: 500, headers: CORS_HEADERS });
  }
}
