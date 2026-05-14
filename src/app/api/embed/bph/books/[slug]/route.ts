import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/books/[slug]
 *
 * Lookup a single BPH book by slug or ID.
 * Returns: title, author, language, date, pages, thumbnail, catalogue number, link.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = await getReadDb();

    // Try slug first, then ID
    const book = await db.collection('books').findOne({
      $or: [{ slug }, { id: slug }],
      held_by: 'bph',
      visible: true,
    }, {
      projection: {
        _id: 0,
        id: 1,
        slug: 1,
        title: 1,
        display_title: 1,
        author: 1,
        editor: 1,
        language: 1,
        published: 1,
        year: 1,
        pages_count: 1,
        pages_translated: 1,
        pages_ocr: 1,
        thumbnail: 1, image_display: 1,
        thumbnail_blob: 1, image_thumb: 1,
        categories: 1,
        'dublin_core.dc_source': 1,
        'dublin_core.dc_description': 1,
        'image_source.provider_name': 1,
        summary: 1,
        reading_summary: 1,
        chapters: 1,
        doi: 1,
        is_first_translation: 1,
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404, headers: CORS_HEADERS });
    }

    const summaryText = book.reading_summary?.overview
      || (typeof book.summary === 'string' ? book.summary : book.summary?.data)
      || null;

    return NextResponse.json({
      id: book.id,
      slug: book.slug || book.id,
      title: book.title,
      display_title: book.display_title,
      author: book.author,
      // Editor — present on edited volumes/magazines/anthologies where the
      // BPH catalogue has no single author. Webflow consumers should render
      // "edited by {editor}" when author is missing or "Unknown".
      editor: book.editor || null,
      language: book.language,
      published: book.published,
      year: book.year,
      pages_count: book.pages_count,
      pages_translated: book.pages_translated || 0,
      pages_ocr: book.pages_ocr || 0,
      thumbnail: book.image_thumb || book.image_display || book.thumbnail_blob || book.thumbnail,
      catalogue_number: book.dublin_core?.dc_source || null,
      description: book.dublin_core?.dc_description || null,
      summary: summaryText,
      categories: book.categories || [],
      chapters: book.chapters || [],
      doi: book.doi || null,
      is_first_translation: book.is_first_translation || false,
      provider: book.image_source?.provider_name || 'Embassy of the Free Mind',
      url: `/book/${book.slug || book.id}`,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH book lookup error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch book' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
