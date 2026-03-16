import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/admin/book-collections
 *
 * List ALL book collections (including subcollections) for admin management.
 * The public /api/collections endpoint filters out subcollections.
 */
export const GET = withAuth(async () => {
  try {
    const db = await getDb();
    const collections = await db
      .collection('collections')
      .find({})
      .sort({ parent: 1, order: 1 })
      .project({
        _id: 0,
        slug: 1,
        name: 1,
        subtitle: 1,
        description: 1,
        expanded_description: 1,
        color: 1,
        order: 1,
        book_count: 1,
        parent: 1,
        languages: 1,
      })
      .toArray();

    return NextResponse.json({ collections });
  } catch (error) {
    console.error('Admin book-collections list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500 }
    );
  }
});
