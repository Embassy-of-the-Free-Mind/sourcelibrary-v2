import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { resolveTenantId } from '@/lib/tenant-context';

interface PageOrder {
  id: string;
  page_number: number;
}

export const POST = withAuth(async (request, session, context) => {
  try {
    const { tenant, id: bookId } = await context.params;
    const body = await request.json();
    const { pages } = body as { pages: PageOrder[] };
    const db = await getDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!pages || !Array.isArray(pages)) {
      return NextResponse.json({ error: 'Pages array required' }, { status: 400 });
    }

    // Verify the book exists
    const book = await db.collection('books').findOne({ id: bookId, tenantId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Update each page's page_number and clear stale thumbnails
    // (page numbers changed, so blob paths like thumbnails/{bookId}/{oldNum}.jpg are wrong)
    const bulkOps = pages.map(({ id, page_number }) => ({
      updateOne: {
        filter: { id, book_id: bookId, tenantId },
        update: {
          $set: { page_number, updated_at: new Date() },
          $unset: { thumbnail_blob: '' }
        }
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
});
