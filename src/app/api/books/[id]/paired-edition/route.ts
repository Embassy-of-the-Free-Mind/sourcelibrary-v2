import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { isBookReadable } from '@/lib/book-access';
import type { Book } from '@/lib/types';
import { getPairedEdition, MARCIANUS_BOOK_ID } from '@/lib/marcianus-overlay';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/books/[id]/paired-edition?pageId=<pages.id>[&page=<page_number>]
 *
 * Reader-support endpoint for the non-destructive edition/facsimile overlay:
 * for a Marcianus gr. Z. 299 folio, returns Berthelot & Ruelle's aligned
 * critical Greek + English (the text of record) plus per-folio confidence
 * badges and a provenance note. Returns `{ paired: null }` for any other book
 * or any folio with no aligned edition page.
 *
 * Plain GET (no withApiAuth): this is browser reader UI for anonymous readers,
 * and the text it surfaces is Berthelot's public edition — the same text served
 * on Berthelot's own reader. Hidden-book access is still gated via
 * isBookReadable. Never writes; see .claude/docs/edition-facsimile-pairing.md.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id: bookId } = await context.params;
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get('pageId');
  const pageParam = searchParams.get('page');
  const pageNumber = pageParam != null && pageParam !== '' ? parseInt(pageParam, 10) : null;

  const db = await getReadDb();

  // Resolve by id / slug / _id, mirroring the quote route.
  let book = (await db.collection('books').findOne({ id: bookId })) as unknown as Book | null;
  if (!book) book = (await db.collection('books').findOne({ slug: bookId })) as unknown as Book | null;
  if (!book && /^[a-f0-9]{24}$/i.test(bookId)) {
    const { ObjectId } = await import('mongodb');
    book = (await db.collection('books').findOne({ _id: new ObjectId(bookId) })) as unknown as Book | null;
  }

  // Overlay is registered for exactly one manuscript today; everything else is a
  // clean no-op so the client panel can be mounted unconditionally.
  if (!book || book.id !== MARCIANUS_BOOK_ID) {
    return NextResponse.json({ paired: null });
  }
  if (!(await isBookReadable(book, request))) {
    return NextResponse.json({ paired: null }, { status: 404 });
  }

  const result = await getPairedEdition(db, {
    pageId,
    pageNumber: pageNumber != null && !Number.isNaN(pageNumber) ? pageNumber : null,
  });
  return NextResponse.json(result);
}
