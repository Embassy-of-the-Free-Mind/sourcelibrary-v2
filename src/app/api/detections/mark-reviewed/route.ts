import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/detections/mark-reviewed
 *
 * Mark a page as reviewed (approved or rejected).
 * Body: { pageId: string, skipped: boolean }
 *   - skipped: false = approved (has good images)
 *   - skipped: true = rejected (no good images)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageId, skipped } = body;

    if (!pageId) {
      return NextResponse.json({ error: 'pageId required' }, { status: 400 });
    }

    const db = await getDb();

    const result = await db.collection('pages').updateOne(
      { id: pageId },
      {
        $set: {
          manually_reviewed: true,
          manually_reviewed_at: new Date(),
          manually_skipped: skipped || false
        }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: result.modifiedCount > 0,
      pageId,
      status: skipped ? 'rejected' : 'approved'
    });
  } catch (error) {
    console.error('Mark reviewed error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mark reviewed' },
      { status: 500 }
    );
  }
}
