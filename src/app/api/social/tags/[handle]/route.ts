/**
 * Individual Social Tag API
 *
 * GET /api/social/tags/[handle] - Get a single tag
 * PATCH /api/social/tags/[handle] - Update a tag
 * DELETE /api/social/tags/[handle] - Delete a tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/social/tags/[handle]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const db = await getDb();

    const tag = await db.collection('social_tags').findOne({ handle });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ tag });
  } catch (error) {
    console.error('Error fetching tag:', error);
    return NextResponse.json({ error: 'Failed to fetch tag' }, { status: 500 });
  }
}

/**
 * PATCH /api/social/tags/[handle]
 *
 * Body (all optional):
 *   - name: string
 *   - audience: string
 *   - description: string
 *   - followers: number
 *   - relevance: string
 *   - active: boolean
 *   - priority: number
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const body = await request.json();

    const db = await getDb();

    // Check tag exists
    const existing = await db.collection('social_tags').findOne({ handle });
    if (!existing) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Build update
    const allowedFields = ['name', 'audience', 'description', 'followers', 'relevance', 'active', 'priority'];
    const update: Record<string, unknown> = {
      updated_at: new Date(),
    };

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'priority') {
          update[field] = Math.min(10, Math.max(1, body[field]));
        } else {
          update[field] = body[field];
        }
      }
    }

    await db.collection('social_tags').updateOne(
      { handle },
      { $set: update }
    );

    const updated = await db.collection('social_tags').findOne({ handle });

    return NextResponse.json({ success: true, tag: updated });
  } catch (error) {
    console.error('Error updating tag:', error);
    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

/**
 * DELETE /api/social/tags/[handle]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const db = await getDb();

    const result = await db.collection('social_tags').deleteOne({ handle });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
