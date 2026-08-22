/**
 * POST /api/account/migrate
 *
 * Migrate anonymous visitor data (likes) to the authenticated user's account.
 * Called client-side after first sign-in if a sl_visitor_id exists in localStorage.
 *
 * Requires NextAuth session. Body: { visitor_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { visitor_id } = body;

    if (!visitor_id || typeof visitor_id !== 'string') {
      return NextResponse.json({ error: 'visitor_id required' }, { status: 400 });
    }

    // Don't migrate if visitor_id is the same as the user's id
    const userId = session.user.id;
    if (visitor_id === userId) {
      return NextResponse.json({ migrated: { likes: 0, bookshelf: 0 }, skipped: true });
    }

    const db = await getDb();

    // Migrate likes: update visitor_id to userId, skip duplicates
    const likesResult = await db.collection('likes').updateMany(
      { visitor_id },
      { $set: { visitor_id: userId } }
    );

    const likesMigrated = likesResult.modifiedCount;

    return NextResponse.json({
      migrated: { likes: likesMigrated },
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
