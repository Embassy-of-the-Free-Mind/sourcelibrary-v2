import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

interface PageOrder {
  id: string;
  page_number: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const { pages } = body as { pages: PageOrder[] };

    if (!pages || !Array.isArray(pages)) {
      return NextResponse.json({ error: 'Pages array required' }, { status: 400 });
    }

    const db = await getDb();

    // Verify the book exists
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Update each page's page_number
    const bulkOps = pages.map(({ id, page_number }) => ({
      updateOne: {
        filter: { id, book_id: bookId },
        update: { $set: { page_number, updated_at: new Date() } }
      }
    }));

    const result = await db.collection('pages').bulkWrite(bulkOps);

    return NextResponse.json({
      success: true,
      modified: result.modifiedCount,
      message: `Reordered ${result.modifiedCount} pages`
    });
  } catch (error) {
    console.error('Error reordering pages:', error);
    return NextResponse.json({ error: 'Failed to reorder pages' }, { status: 500 });
  }
}
