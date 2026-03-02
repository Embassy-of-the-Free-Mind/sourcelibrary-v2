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

    // Nothing to fix — archive.org URLs are valid for Next.js Image (in remotePatterns).
    // Previously this route wrapped URLs in /api/image?url= proxy, which crashes SSR.
    return NextResponse.json({
      success: true,
      booksFixed: 0,
      message: `No-op: archive.org URLs work directly with Next.js Image. Found ${books.length} books with archive.org thumbnails (no changes needed).`
    });
  } catch (error) {
    console.error('Error fixing thumbnails:', error);
    return NextResponse.json(
      { error: 'Failed to fix thumbnails' },
      { status: 500 }
    );
  }
});
