import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// GET /api/encyclopedia/[slug]/sources - Get books mentioning this term
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = await getDb();

    // Get the encyclopedia entry
    const entry = await db.collection('encyclopedia').findOne({ slug });

    if (!entry) {
      return NextResponse.json(
        { error: 'Encyclopedia entry not found' },
        { status: 404 }
      );
    }

    // Get primary sources (manually linked)
    const primarySourceBookIds = entry.primary_sources?.map(
      (s: { book_id: string }) => s.book_id
    ) || [];

    // Get books via term links (auto-linked)
    const termLinks = await db.collection('term_links')
      .find({
        encyclopedia_id: entry.id,
        confidence: { $ne: 'rejected' },
      })
      .toArray();

    const termLinkBookIds = [...new Set(termLinks.map(tl => tl.book_id))];

    // Combine all book IDs
    const allBookIds = [...new Set([...primarySourceBookIds, ...termLinkBookIds])];

    // Fetch book details
    const books = await db.collection('books')
      .find({ id: { $in: allBookIds } })
      .project({
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        published: 1,
        thumbnail: 1,
        pages_count: 1,
        translation_percent: 1,
      })
      .toArray();

    // Group term links by book for page references
    const termLinksByBook: Record<string, { page_number: number; page_id: string; term: string }[]> = {};
    for (const tl of termLinks) {
      if (!termLinksByBook[tl.book_id]) {
        termLinksByBook[tl.book_id] = [];
      }
      termLinksByBook[tl.book_id].push({
        page_number: tl.page_number,
        page_id: tl.page_id,
        term: tl.term,
      });
    }

    // Combine primary sources with auto-detected
    const sources = books.map(book => {
      const primarySource = entry.primary_sources?.find(
        (s: { book_id: string }) => s.book_id === book.id
      );
      const autoDetectedPages = termLinksByBook[book.id] || [];

      return {
        book,
        is_primary: !!primarySource,
        primary_quote: primarySource?.quote,
        primary_pages: primarySource?.page_numbers || [],
        auto_detected_pages: autoDetectedPages,
        total_mentions:
          (primarySource?.page_numbers?.length || 0) + autoDetectedPages.length,
      };
    });

    // Sort by total mentions (most mentions first)
    sources.sort((a, b) => b.total_mentions - a.total_mentions);

    return NextResponse.json({
      entry: {
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        type: entry.type,
      },
      sources,
      total_books: sources.length,
    });
  } catch (error) {
    console.error('Error fetching encyclopedia sources:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sources' },
      { status: 500 }
    );
  }
}
