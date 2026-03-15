import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { scoreBooksProcessingPriority } from '@/lib/processing-priority';
import { withAdminAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/admin/processing-priority — View priority distribution
 */
export const GET = withAdminAuth(async () => {
  try {
    const db = await getDb();

    const [distribution, topBooks, bottomBooks, unscored] = await Promise.all([
      // Score distribution
      db.collection('books').aggregate([
        { $match: { processing_priority: { $exists: true } } },
        {
          $bucket: {
            groupBy: '$processing_priority',
            boundaries: [0, 30, 50, 70, 90, 101],
            default: 'other',
            output: { count: { $sum: 1 } },
          },
        },
      ]).toArray(),
      // Top 20 by priority
      db.collection('books')
        .find({ processing_priority: { $exists: true } })
        .sort({ processing_priority: -1 })
        .project({ id: 1, title: 1, display_title: 1, processing_priority: 1, language: 1, categories: 1, pages_count: 1 })
        .limit(20)
        .toArray(),
      // Bottom 10
      db.collection('books')
        .find({ processing_priority: { $exists: true, $gt: 0 } })
        .sort({ processing_priority: 1 })
        .project({ id: 1, title: 1, display_title: 1, processing_priority: 1, language: 1 })
        .limit(10)
        .toArray(),
      // Count unscored
      db.collection('books').countDocuments({ processing_priority: { $exists: false } }),
    ]);

    return NextResponse.json({
      distribution,
      unscored,
      top_books: topBooks.map(b => ({
        id: b.id,
        title: b.display_title || b.title,
        score: b.processing_priority,
        language: b.language,
        categories: b.categories,
        pages: b.pages_count,
      })),
      bottom_books: bottomBooks.map(b => ({
        id: b.id,
        title: b.display_title || b.title,
        score: b.processing_priority,
        language: b.language,
      })),
    });
  } catch (error) {
    console.error('Error fetching priority distribution:', error);
    return NextResponse.json({ error: 'Failed to fetch distribution' }, { status: 500 });
  }
});

/**
 * POST /api/admin/processing-priority — Batch score books
 *
 * Body options:
 *   { bookIds?: string[] }  — score specific books
 *   { all: true }           — score all books
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const db = await getDb();

    const options: { bookIds?: string[]; limit?: number } = {};
    if (body.bookIds?.length) {
      options.bookIds = body.bookIds;
    }
    if (!body.all && !body.bookIds?.length) {
      // Default: score unscored books only, limit 1000
      options.limit = body.limit || 1000;
    }

    const result = await scoreBooksProcessingPriority(db, options);

    return NextResponse.json({
      scored: result.scored,
      distribution: result.distribution,
    });
  } catch (error) {
    console.error('Error batch scoring:', error);
    return NextResponse.json({ error: 'Failed to batch score' }, { status: 500 });
  }
});
