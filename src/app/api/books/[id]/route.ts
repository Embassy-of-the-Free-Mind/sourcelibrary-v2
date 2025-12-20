import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { trackEvent, getVisitorInfo } from '@/lib/analytics';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get pages for this book
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .toArray();

    // Track book view with visitor info
    const visitorInfo = getVisitorInfo(request);
    trackEvent('book_view', {
      book_id: id,
      tenant_id: book.tenant_id,
      ...visitorInfo,
    });

    return NextResponse.json({ ...book, pages });
  } catch (error) {
    console.error('Error fetching book:', error);
    return NextResponse.json({ error: 'Failed to fetch book' }, { status: 500 });
  }
}
