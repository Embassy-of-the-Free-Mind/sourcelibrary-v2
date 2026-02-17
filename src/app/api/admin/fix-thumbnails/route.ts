import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

// POST /api/admin/fix-thumbnails
// Converts raw archive.org thumbnail URLs to use the image proxy
export const POST = withAuth(async (request, session) => {
  try {
    const db = await getDb();

    const books = await db.collection('books').find({
      thumbnail: { $regex: '^https://archive\\.org', $options: 'i' }
    }).toArray();

    let updated = 0;
    for (const book of books) {
      const rawUrl = book.thumbnail;
      // Wrap in our image proxy for caching and resizing
      const proxiedUrl = `/api/image?url=${encodeURIComponent(rawUrl)}&w=400&q=80`;

      await db.collection('books').updateOne(
        { _id: book._id },
        { $set: { thumbnail: proxiedUrl, updated_at: new Date() } }
      );
      updated++;
    }

    return NextResponse.json({
      success: true,
      booksFixed: updated,
      message: `Updated ${updated} book thumbnails to use image proxy`
    });
  } catch (error) {
    console.error('Error fixing thumbnails:', error);
    return NextResponse.json(
      { error: 'Failed to fix thumbnails' },
      { status: 500 }
    );
  }
});
