import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
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

    // Look up the page to get its ID
    const db = await getDb();
    const page = await db.collection('pages').findOne({
      book_id: bookId,
      page_number: pageNumber,
    }) as unknown as Page | null;

    if (!page) {
      // Redirect to book page if specific page not found
      return NextResponse.redirect(
        new URL(`/book/${bookId}`, request.url),
        { status: 302 }
      );
    }

    // Redirect to the full page URL
    return NextResponse.redirect(
      new URL(`/book/${bookId}/page/${page.id}`, request.url),
      { status: 302 }
    );
  } catch (error) {
    console.error('Shortlink decode error:', error);
    // Invalid shortlink - redirect to home
    return NextResponse.redirect(new URL('/', request.url), { status: 302 });
  }
}
