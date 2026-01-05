/**
 * My Likes API
 *
 * GET /api/likes/mine - Get all likes for a visitor
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { LikeTargetType } from '@/lib/types';

/**
 * GET /api/likes/mine
 *
 * Get all likes for a visitor (for syncing localStorage).
 *
 * Query params:
 *   - visitor_id: string (required)
 *   - type: 'image' | 'page' | 'book' (optional, filter by type)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const visitorId = searchParams.get('visitor_id');
    const targetType = searchParams.get('type') as LikeTargetType | null;

    if (!visitorId) {
      return NextResponse.json(
        { error: 'visitor_id is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    const query: Record<string, unknown> = { visitor_id: visitorId };
    if (targetType && ['image', 'page', 'book'].includes(targetType)) {
      query.target_type = targetType;
    }

    const likes = await db.collection('likes')
      .find(query)
      .project({ target_type: 1, target_id: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(500)  // Reasonable limit
      .toArray();

    // Group by type
    const byType = {
      image: [] as string[],
      page: [] as string[],
      book: [] as string[],
    };

    for (const like of likes) {
      if (like.target_type in byType) {
        byType[like.target_type as keyof typeof byType].push(like.target_id);
      }
    }

    return NextResponse.json({
      likes: byType,
      total: likes.length,
    });
  } catch (error) {
    console.error('Error getting my likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
