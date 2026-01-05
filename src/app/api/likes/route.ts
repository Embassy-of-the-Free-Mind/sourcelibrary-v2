/**
 * Likes API
 *
 * POST /api/likes - Toggle a like
 * GET /api/likes - Get like counts and check if visitor has liked
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { LikeTargetType } from '@/lib/types';

/**
 * POST /api/likes
 *
 * Toggle a like for a target. If already liked, removes it. If not, adds it.
 *
 * Body:
 *   - target_type: 'image' | 'page' | 'book'
 *   - target_id: string
 *   - visitor_id: string (from localStorage)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target_type, target_id, visitor_id } = body;

    if (!target_type || !target_id || !visitor_id) {
      return NextResponse.json(
        { error: 'target_type, target_id, and visitor_id are required' },
        { status: 400 }
      );
    }

    if (!['image', 'page', 'book'].includes(target_type)) {
      return NextResponse.json(
        { error: 'target_type must be image, page, or book' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if already liked
    const existing = await db.collection('likes').findOne({
      target_type,
      target_id,
      visitor_id,
    });

    let liked: boolean;

    if (existing) {
      // Unlike
      await db.collection('likes').deleteOne({
        target_type,
        target_id,
        visitor_id,
      });
      liked = false;
    } else {
      // Like
      await db.collection('likes').insertOne({
        target_type,
        target_id,
        visitor_id,
        created_at: new Date(),
      });
      liked = true;
    }

    // Get new count
    const count = await db.collection('likes').countDocuments({
      target_type,
      target_id,
    });

    return NextResponse.json({
      success: true,
      liked,
      count,
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle like' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/likes
 *
 * Get like counts and check if visitor has liked.
 *
 * Query params:
 *   - targets: JSON array of {type, id} objects
 *   - visitor_id: string (optional, to check if liked)
 *
 * Example: /api/likes?targets=[{"type":"image","id":"abc:0"}]&visitor_id=xyz
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetsJson = searchParams.get('targets');
    const visitorId = searchParams.get('visitor_id');

    if (!targetsJson) {
      return NextResponse.json(
        { error: 'targets parameter is required' },
        { status: 400 }
      );
    }

    let targets: Array<{ type: LikeTargetType; id: string }>;
    try {
      targets = JSON.parse(targetsJson);
    } catch {
      return NextResponse.json(
        { error: 'Invalid targets JSON' },
        { status: 400 }
      );
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // Limit to 100 targets per request
    if (targets.length > 100) {
      targets = targets.slice(0, 100);
    }

    const db = await getDb();

    // Build aggregation to get counts
    const countPipeline = [
      {
        $match: {
          $or: targets.map(t => ({
            target_type: t.type,
            target_id: t.id,
          })),
        },
      },
      {
        $group: {
          _id: { type: '$target_type', id: '$target_id' },
          count: { $sum: 1 },
        },
      },
    ];

    const counts = await db.collection('likes').aggregate(countPipeline).toArray();

    // Build results map
    const results: Record<string, { count: number; liked: boolean }> = {};

    // Initialize all targets with 0
    for (const target of targets) {
      const key = `${target.type}:${target.id}`;
      results[key] = { count: 0, liked: false };
    }

    // Fill in counts
    for (const c of counts) {
      const key = `${c._id.type}:${c._id.id}`;
      if (results[key]) {
        results[key].count = c.count;
      }
    }

    // Check if visitor has liked (if visitor_id provided)
    if (visitorId) {
      const visitorLikes = await db.collection('likes').find({
        visitor_id: visitorId,
        $or: targets.map(t => ({
          target_type: t.type,
          target_id: t.id,
        })),
      }).toArray();

      for (const like of visitorLikes) {
        const key = `${like.target_type}:${like.target_id}`;
        if (results[key]) {
          results[key].liked = true;
        }
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Error getting likes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get likes' },
      { status: 500 }
    );
  }
}
