import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getRoomBySlug, findBookInRoom } from '@/lib/reading-rooms';
import { ROOMS_ROOT } from '@/lib/reading-rooms-paths';
import { resolvePageByNumber } from '@/lib/page-number-resolve';

interface RouteContext {
  params: Promise<{ slug: string; book: string; num: string }>;
}

/**
 * /rooms/[slug]/book/[book]/page-number/[num] → 308 to the room's reader at
 * the canonical page id. Twin of the /embed/[tenant] route: printed-page
 * citations circulate, and the redirect must stay inside the room.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { slug, book, num } = await params;
  const pageNumber = parseInt(num, 10);
  if (isNaN(pageNumber)) return new NextResponse('Not Found', { status: 404 });

  const db = await getReadDb();
  const room = await getRoomBySlug(db, slug);
  if (!room) return new NextResponse('Not Found', { status: 404 });

  const result = await findBookInRoom(db, room, book, { id: 1, slug: 1 });
  if (!result) return NextResponse.redirect(new URL(`${ROOMS_ROOT}/${room.slug}`, request.url), 307);

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  const page = await resolvePageByNumber(db, bookId, pageNumber);
  if (!page) return new NextResponse('Not Found', { status: 404 });

  const pageId = page.id || page._id?.toString();
  const destination = new URL(`${ROOMS_ROOT}/${room.slug}/book/${bookSlug}/page/${pageId}`, request.url);
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}
