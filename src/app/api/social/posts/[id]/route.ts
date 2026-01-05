/**
 * Single Social Post API
 *
 * GET /api/social/posts/[id] - Get a single post
 * PATCH /api/social/posts/[id] - Update a post
 * DELETE /api/social/posts/[id] - Delete a post
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { SocialPostStatus } from '@/lib/types';
import { buildFullTweetText } from '@/lib/tweet-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/social/posts/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const post = await db.collection('social_posts').findOne({ id });

    if (!post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ post });
  } catch (error) {
    console.error('Error getting post:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get post' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/social/posts/[id]
 *
 * Body (all optional):
 *   - tweet_text: string
 *   - hashtags: string[]
 *   - status: 'draft' | 'queued'
 *   - scheduled_for: Date string or null
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = await getDb();

    // Get existing post
    const existing = await db.collection('social_posts').findOne({ id });

    if (!existing) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    // Can't update posted or failed posts (except to retry failed)
    if (existing.status === 'posted') {
      return NextResponse.json(
        { error: 'Cannot update a posted tweet' },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {
      updated_at: new Date(),
    };

    // Update tweet text
    if (body.tweet_text !== undefined) {
      const fullTweet = buildFullTweetText(
        body.tweet_text,
        body.hashtags || existing.hashtags,
        existing.image_ref.gallery_image_id
      );

      if (fullTweet.length > 280) {
        return NextResponse.json(
          { error: `Tweet too long (${fullTweet.length}/280 chars)` },
          { status: 400 }
        );
      }

      update.tweet_text = body.tweet_text;
    }

    // Update hashtags
    if (body.hashtags !== undefined) {
      update.hashtags = body.hashtags;
    }

    // Update status
    if (body.status !== undefined) {
      const validStatuses: SocialPostStatus[] = ['draft', 'queued'];
      if (validStatuses.includes(body.status)) {
        update.status = body.status;
      } else if (body.status === 'draft' && existing.status === 'failed') {
        // Allow resetting failed posts to draft for retry
        update.status = 'draft';
        update.error = null;
      }
    }

    // Update scheduled time
    if (body.scheduled_for !== undefined) {
      update.scheduled_for = body.scheduled_for ? new Date(body.scheduled_for) : null;
    }

    const result = await db.collection('social_posts').findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after' }
    );

    return NextResponse.json({
      success: true,
      post: result,
    });
  } catch (error) {
    console.error('Error updating post:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update post' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/social/posts/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const existing = await db.collection('social_posts').findOne({ id });

    if (!existing) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    // Warn if deleting a posted tweet (doesn't delete from Twitter)
    if (existing.status === 'posted') {
      console.warn(`Deleting record for posted tweet ${existing.twitter_id}`);
    }

    await db.collection('social_posts').deleteOne({ id });

    return NextResponse.json({
      success: true,
      deleted: id,
      warning: existing.status === 'posted'
        ? 'Note: This only deletes the record. The tweet remains on Twitter.'
        : undefined,
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete post' },
      { status: 500 }
    );
  }
}
