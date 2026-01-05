/**
 * Social Tags API
 *
 * GET /api/social/tags - List all tags, optionally filtered by audience
 * POST /api/social/tags - Add a new tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SocialTag } from '@/lib/types';

/**
 * GET /api/social/tags
 *
 * Query params:
 *   - audience: Filter by audience (optional)
 *   - active: Filter by active status (optional, default: true)
 *   - forTweet: If true, returns suggested handles for tagging (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const audience = searchParams.get('audience');
    const activeParam = searchParams.get('active');
    const forTweet = searchParams.get('forTweet') === 'true';

    const db = await getDb();

    // Build query
    const query: Record<string, unknown> = {};
    if (audience) {
      query.audience = audience;
    }
    if (activeParam !== null) {
      query.active = activeParam === 'true';
    } else {
      query.active = true; // Default to active only
    }

    // Get tags sorted by priority
    const tags = await db
      .collection<SocialTag>('social_tags')
      .find(query)
      .sort({ priority: -1, followers: -1 })
      .toArray();

    // If for tweet, return simplified format
    if (forTweet) {
      const suggestions = tags.slice(0, 5).map(t => ({
        handle: t.handle,
        name: t.name,
        audience: t.audience,
      }));
      return NextResponse.json({ suggestions });
    }

    // Group by audience for UI
    const byAudience: Record<string, SocialTag[]> = {};
    for (const tag of tags) {
      if (!byAudience[tag.audience]) {
        byAudience[tag.audience] = [];
      }
      byAudience[tag.audience].push(tag);
    }

    return NextResponse.json({
      tags,
      byAudience,
      total: tags.length,
    });
  } catch (error) {
    console.error('Error fetching social tags:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/social/tags
 *
 * Body:
 *   - handle: string (required)
 *   - name: string (required)
 *   - audience: string (required)
 *   - description: string (optional)
 *   - followers: number (optional)
 *   - relevance: string (required)
 *   - priority: number (optional, default: 5)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      handle,
      name,
      audience,
      description,
      followers,
      relevance,
      priority = 5,
    } = body;

    // Validate required fields
    if (!handle || !name || !audience || !relevance) {
      return NextResponse.json(
        { error: 'handle, name, audience, and relevance are required' },
        { status: 400 }
      );
    }

    // Clean handle (remove @ if present)
    const cleanHandle = handle.replace(/^@/, '');

    const db = await getDb();

    // Check for duplicate
    const existing = await db
      .collection('social_tags')
      .findOne({ handle: cleanHandle });

    if (existing) {
      return NextResponse.json(
        { error: 'Tag with this handle already exists' },
        { status: 409 }
      );
    }

    const now = new Date();
    const tag: Omit<SocialTag, '_id'> = {
      handle: cleanHandle,
      name,
      audience,
      description,
      followers,
      relevance,
      active: true,
      priority: Math.min(10, Math.max(1, priority)),
      created_at: now,
      updated_at: now,
    };

    await db.collection('social_tags').insertOne(tag);

    return NextResponse.json({ success: true, tag });
  } catch (error) {
    console.error('Error creating social tag:', error);
    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    );
  }
}
