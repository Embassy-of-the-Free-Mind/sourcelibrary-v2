/**
 * Refresh Tweet Metrics
 * POST /api/social/posts/refresh-metrics - Fetch and update metrics for posted tweets
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isTwitterConfigured, getTweetMetricsBatch } from '@/lib/twitter';

export async function POST(request: NextRequest) {
  try {
    if (!isTwitterConfigured()) {
      return NextResponse.json(
        { error: 'Twitter not configured' },
        { status: 503 }
      );
    }

    const db = await getDb();

    // Get post IDs from request body (optional - if not provided, refresh all)
    const body = await request.json().catch(() => ({}));
    const postIds: string[] | undefined = body.postIds;

    // Find posts that have been tweeted
    const query: Record<string, unknown> = {
      status: 'posted',
      twitter_id: { $exists: true, $ne: null },
    };

    if (postIds && postIds.length > 0) {
      query.id = { $in: postIds };
    }

    const posts = await db.collection('social_posts')
      .find(query)
      .project({ id: 1, twitter_id: 1 })
      .toArray();

    if (posts.length === 0) {
      return NextResponse.json({
        updated: 0,
        message: 'No posted tweets to refresh',
      });
    }

    // Get tweet IDs
    const tweetIds = posts.map((p: { twitter_id?: string }) => p.twitter_id).filter((id): id is string => Boolean(id));

    // Fetch metrics from Twitter
    const metricsMap = await getTweetMetricsBatch(tweetIds);

    // Update each post with its metrics
    let updated = 0;
    for (const post of posts) {
      const metrics = metricsMap.get(post.twitter_id);
      if (metrics) {
        await db.collection('social_posts').updateOne(
          { id: post.id },
          {
            $set: {
              metrics,
              updated_at: new Date(),
            },
          }
        );
        updated++;
      }
    }

    return NextResponse.json({
      updated,
      total: posts.length,
      message: `Updated metrics for ${updated} of ${posts.length} posts`,
    });
  } catch (error) {
    console.error('Error refreshing metrics:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh metrics' },
      { status: 500 }
    );
  }
}
