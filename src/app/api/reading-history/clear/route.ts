import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/reading-history/clear — clear reading history
 * Body: { book_id?: string } — clear one book or all
 */
export const POST = withAuth(async (request, session) => {
  const userId = session.user!.id as string;
  const body = await request.json().catch(() => ({}));
  const { book_id } = body as { book_id?: string };

  const db = await getDb();
  const filter: Record<string, string> = { user_id: userId };
  if (book_id) filter.book_id = book_id;

  const result = await db.collection('reading_history').deleteMany(filter);

  return NextResponse.json({
    success: true,
    deleted: result.deletedCount,
  });
});
