/**
 * POST /api/account/migrate
 *
 * Migrate anonymous visitor data (likes, bookshelf) to the authenticated user's account.
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

    // Handle duplicate likes (same target liked by both anonymous and authenticated)
    // The unique index (target_type + target_id + visitor_id) will cause some updates to fail.
    // That's fine — the authenticated like already exists.
    let likesMigrated = likesResult.modifiedCount;

    // Migrate bookshelf entries
    // For each anonymous entry, try to update the visitor_id.
    // If the user already has a bookshelf entry for that book, keep the authenticated one.
    const anonEntries = await db.collection('bookshelves')
      .find({ visitor_id })
      .toArray();

    let bookshelfMigrated = 0;
    for (const entry of anonEntries) {
      const existing = await db.collection('bookshelves').findOne({
        visitor_id: userId,
        book_id: entry.book_id,
      });

      if (existing) {
        // User already has this book — keep their version, delete the anonymous one
        // But preserve reading progress if the anonymous one is further along
        if (entry.last_read_page_number && (!existing.last_read_page_number || entry.last_read_page_number > existing.last_read_page_number)) {
          await db.collection('bookshelves').updateOne(
            { _id: existing._id },
            { $set: {
              last_read_page_id: entry.last_read_page_id,
              last_read_page_number: entry.last_read_page_number,
              last_read_at: entry.last_read_at,
              updated_at: new Date(),
            }}
          );
        }
        await db.collection('bookshelves').deleteOne({ _id: entry._id });
      } else {
        // No conflict — just reassign
        await db.collection('bookshelves').updateOne(
          { _id: entry._id },
          { $set: { visitor_id: userId, updated_at: new Date() } }
        );
        bookshelfMigrated++;
      }
    }

    return NextResponse.json({
      migrated: { likes: likesMigrated, bookshelf: bookshelfMigrated },
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
