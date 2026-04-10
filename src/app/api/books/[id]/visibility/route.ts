import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withCuratorAuth } from '@/lib/auth-helpers';

/**
 * POST /api/books/[id]/visibility
 *
 * Toggle book visibility for curation.
 * Body: { hidden: boolean, reason?: string }
 */
export const POST = withCuratorAuth(async (
  request: NextRequest,
) => {
  try {
    // Extract book ID from URL path: /api/books/[id]/visibility
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.indexOf('books') + 1];
    const body = await request.json();
    const { hidden, reason } = body;

    if (typeof hidden !== 'boolean') {
      return NextResponse.json(
        { error: 'hidden must be a boolean' },
        { status: 400 }
      );
    }

    const db = await getDb();

    const update: Record<string, unknown> = {
      hidden,
      visible: !hidden,
      updated_at: new Date(),
    };

    if (hidden && reason) {
      update.hidden_reason = reason;
    }

    if (!hidden) {
      // When un-hiding, clear the reason
      await db.collection('books').updateOne(
        { id },
        { $set: update, $unset: { hidden_reason: '' } }
      );
    } else {
      await db.collection('books').updateOne(
        { id },
        { $set: update }
      );
    }

    const book = await db.collection('books').findOne(
      { id },
      { projection: { id: 1, title: 1, hidden: 1, hidden_reason: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: book.id,
      title: book.title,
      hidden: book.hidden,
      hidden_reason: book.hidden_reason,
    });
  } catch (error) {
    console.error('Visibility toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to update visibility' },
      { status: 500 }
    );
  }
});
