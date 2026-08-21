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
    // `?lang=<iso>` sends the reader to that language's twin (#4095). The code
    // itself stays canonical — one shortlink per leaf, printable in a footnote
    // — and the language is a preference laid over it.
    const requested = (request.nextUrl.searchParams.get('lang') || '').trim().toLowerCase();
    const lang = /^[a-z]{2,3}$/.test(requested) && requested !== 'en' ? requested : null;

    const db = await getReadDb();
    const [page, book] = await Promise.all([
      db.collection('pages').findOne({
        book_id: bookId,
        page_number: pageNumber,
      }) as unknown as Promise<Page | null>,
      db.collection('books').findOne(
        { id: bookId },
        // The counter decides whether the localized twin exists. Sending a
        // reader to `/es/book/…` for a book with no Spanish pages costs them a
        // second redirect back to English (i18n.md, "an /es URL is a promise"),
        // so check here rather than hand off a URL that will bounce.
        { projection: { _id: 0, id: 1, slug: 1, ...(lang ? { [`pages_translated_${lang}`]: 1 } : {}) } },
      ),
    ]);
    const bookPath = (book?.slug as string) || bookId;
    const prefix = lang && Number(book?.[`pages_translated_${lang}`] || 0) > 0 ? `/${lang}` : '';

    if (!page) {
      // Redirect to book page if specific page not found
      return NextResponse.redirect(
        new URL(`${prefix}/book/${bookPath}`, request.url),
        { status: 302 }
      );
    }

    // Redirect to the full page URL
    return NextResponse.redirect(
      new URL(`${prefix}/book/${bookPath}/page/${page.id}`, request.url),
      { status: 302 }
    );
  } catch (error) {
    console.error('Shortlink decode error:', error);
    // Invalid shortlink - redirect to home
    return NextResponse.redirect(new URL('/', request.url), { status: 302 });
  }
}
