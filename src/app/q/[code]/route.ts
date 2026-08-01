import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { decodeShortlink } from '@/lib/shortlinks';
import { Page } from '@/lib/types';

interface RouteContext {
  params: Promise<{ code: string }>;
}

/**
 * GET /q/[code] - Redirect shortlink to full page URL
 *
 * Decodes the base62 shortlink to get book ID and page number,
 * looks up the page ID, and redirects to the full URL.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { code } = await context.params;

    // Decode the shortlink
    const { bookId, pageNumber } = decodeShortlink(code);

    // Look up the page to get its ID, and the book to get its slug. The
    // shortlink encodes an ObjectId, so without the slug every shortlink we
    // publish would land on /book/<objectid>/page/<pageid> and take a second
    // redirect to reach its readable form. One projection, one hop.
    const db = await getReadDb();
    const [page, book] = await Promise.all([
      db.collection('pages').findOne({
        book_id: bookId,
        page_number: pageNumber,
      }) as unknown as Promise<Page | null>,
      db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, slug: 1 } }),
    ]);
    const bookPath = (book?.slug as string) || bookId;

    if (!page) {
      // Redirect to book page if specific page not found
      return NextResponse.redirect(
        new URL(`/book/${bookPath}`, request.url),
        { status: 302 }
      );
    }

    // Redirect to the full page URL
    return NextResponse.redirect(
      new URL(`/book/${bookPath}/page/${page.id}`, request.url),
      { status: 302 }
    );
  } catch (error) {
    console.error('Shortlink decode error:', error);
    // Invalid shortlink - redirect to home
    return NextResponse.redirect(new URL('/', request.url), { status: 302 });
  }
}
