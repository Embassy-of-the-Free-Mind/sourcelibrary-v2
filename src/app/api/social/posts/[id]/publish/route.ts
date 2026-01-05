/**
 * Publish Tweet API
 *
 * POST /api/social/posts/[id]/publish
 * Post a tweet to Twitter immediately
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { postTweetWithMedia, isTwitterConfigured } from '@/lib/twitter';
import { buildFullTweetText } from '@/lib/tweet-generator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/social/posts/[id]/publish
 *
 * Publishes the post to Twitter with media attachment.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Check Twitter is configured
    if (!isTwitterConfigured()) {
      return NextResponse.json(
        { error: 'Twitter API credentials not configured' },
        { status: 400 }
      );
    }

    // Get the post
    const post = await db.collection('social_posts').findOne({ id });

    if (!post) {
      return NextResponse.json(
        { error: 'Post not found' },
        { status: 404 }
      );
    }

    // Check if already posted
    if (post.status === 'posted') {
      return NextResponse.json(
        {
          error: 'Already posted',
          twitter_url: post.twitter_url,
        },
        { status: 400 }
      );
    }

    // Check if tweet text exists
    if (!post.tweet_text) {
      return NextResponse.json(
        { error: 'Tweet text is empty. Generate or set tweet text first.' },
        { status: 400 }
      );
    }

    // Get config for usage tracking
    const config = await db.collection('social_config').findOne({ platform: 'twitter' });

    // Check rate limits
    if (config?.settings?.posts_per_day) {
      const dailyLimit = config.settings.posts_per_day;
      const tweetsToday = config.usage?.tweets_today || 0;

      if (tweetsToday >= dailyLimit) {
        return NextResponse.json(
          {
            error: `Daily limit reached (${tweetsToday}/${dailyLimit} tweets today)`,
            limit: dailyLimit,
            used: tweetsToday,
          },
          { status: 429 }
        );
      }
    }

    // Build full tweet text
    const fullTweet = buildFullTweetText(
      post.tweet_text,
      post.hashtags || [],
      post.image_ref.gallery_image_id
    );

    // Get image URL - make sure it's absolute
    let imageUrl = post.image_data.cropped_url;
    if (imageUrl.startsWith('/')) {
      imageUrl = `https://sourcelibrary.org${imageUrl}`;
    }

    try {
      // Post to Twitter
      const result = await postTweetWithMedia(fullTweet, imageUrl);

      // Update post record
      await db.collection('social_posts').updateOne(
        { id },
        {
          $set: {
            status: 'posted',
            posted_at: new Date(),
            twitter_id: result.tweetId,
            twitter_url: result.tweetUrl,
            updated_at: new Date(),
          },
        }
      );

      // Update usage counters
      await db.collection('social_config').updateOne(
        { platform: 'twitter' },
        {
          $inc: {
            'usage.tweets_today': 1,
            'usage.tweets_this_month': 1,
          },
          $set: {
            'usage.last_tweet_at': new Date(),
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );

      return NextResponse.json({
        success: true,
        tweetId: result.tweetId,
        tweetUrl: result.tweetUrl,
      });
    } catch (twitterError) {
      console.error('Twitter API error:', twitterError);

      // Update post with error
      await db.collection('social_posts').updateOne(
        { id },
        {
          $set: {
            status: 'failed',
            error: twitterError instanceof Error ? twitterError.message : 'Twitter API error',
            updated_at: new Date(),
          },
        }
      );

      return NextResponse.json(
        {
          error: 'Failed to post to Twitter',
          details: twitterError instanceof Error ? twitterError.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error publishing post:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish' },
      { status: 500 }
    );
  }
}
