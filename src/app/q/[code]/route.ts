import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { decodeShortlink } from '@/lib/shortlinks';
import { Page } from '@/lib/types';

interface RouteContext {
  params: Promise<{ code: string }>;
}

/**
 * GET /q/[code] — Decode shortlink and redirect to the full page URL.
 *
 * The [tenant]/q/[code] route handles tenant-scoped shortlinks (e.g.
 * bph.sourcelibrary.org/q/ABC after proxy rewrites). This route handles the
 * canonical sourcelibrary.org/q/ABC form (2-segment path, no tenant prefix).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { code } = await context.params;
    const { bookId, pageNumber } = decodeShortlink(code);

    const db = await getReadDb();
    const page = await db.collection('pages').findOne({
      book_id: bookId,
      page_number: pageNumber,
    }) as unknown as Page | null;

    if (!page) {
      return NextResponse.redirect(new URL(`/book/${bookId}`, request.url), { status: 302 });
    }

    return NextResponse.redirect(
      new URL(`/book/${bookId}/page/${page.id}`, request.url),
      { status: 302 }
    );
  } catch {
    return NextResponse.redirect(new URL('/', request.url), { status: 302 });
  }
}
