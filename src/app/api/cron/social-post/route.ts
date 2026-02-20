/**
 * Automated Social Media Posting Cron Job
 *
 * POST /api/cron/social-post
 *
 * Runs hourly to post queued tweets at configured times.
 * Add to vercel.json crons: { path: "/api/cron/social-post", schedule: "0 * * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { postTweetWithMedia, isTwitterConfigured } from '@/lib/twitter';
import { buildFullTweetText } from '@/lib/tweet-generator';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 60; // 1 minute timeout

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const logger = createCronLogger('social-post');

  const stats = {
    posted: 0,
    failed: 0,
    skipped: 0,
  };

  let response: NextResponse;

  try {
    // Check Twitter is configured
    if (!isTwitterConfigured()) {
      logger.skip('Twitter not configured');
      response = NextResponse.json({
        message: 'Twitter not configured',
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    const db = await getDb();

    // Get config
    const config = await db.collection('social_config').findOne({ platform: 'twitter' });

    // Check if auto-posting is enabled
    if (!config?.settings?.auto_post_enabled) {
      logger.skip('Auto-posting is disabled');
      response = NextResponse.json({
        message: 'Auto-posting is disabled',
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    // Check if current hour is in posting hours
    const currentHour = new Date().getUTCHours();
    const postingHours = config.settings.posting_hours || [];

    if (!postingHours.includes(currentHour)) {
      logger.decision('early_return', `Not a posting hour (${currentHour} UTC)`, { currentHour, postingHours });
      response = NextResponse.json({
        message: `Not a posting hour (current: ${currentHour} UTC, configured: ${postingHours.join(', ')})`,
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    // Check daily limit
    const dailyLimit = config.settings.posts_per_day || 2;
    const tweetsToday = config.usage?.tweets_today || 0;

    if (tweetsToday >= dailyLimit) {
      logger.decision('backpressure', `Daily limit reached (${tweetsToday}/${dailyLimit})`, { tweetsToday, dailyLimit });
      response = NextResponse.json({
        message: `Daily limit reached (${tweetsToday}/${dailyLimit})`,
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    // Find next queued post
    // Priority: scheduled posts that are due, then oldest queued post
    const now = new Date();

    const post = await db.collection('social_posts').findOne(
      {
        status: 'queued',
        $or: [
          { scheduled_for: { $lte: now } },
          { scheduled_for: { $exists: false } },
          { scheduled_for: null },
        ],
      },
      {
        sort: { scheduled_for: 1, created_at: 1 },
      }
    );

    if (!post) {
      logger.skip('No posts in queue');
      response = NextResponse.json({
        message: 'No posts in queue',
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    // Check if tweet text exists
    if (!post.tweet_text) {
      // Skip posts without text
      await db.collection('social_posts').updateOne(
        { id: post.id },
        {
          $set: {
            status: 'failed',
            error: 'Tweet text is empty',
            updated_at: new Date(),
          },
        }
      );
      stats.skipped++;
      logger.skip('Skipped post with empty tweet text', { post_id: post.id });

      response = NextResponse.json({
        message: 'Skipped post with empty tweet text',
        postId: post.id,
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }

    // Build full tweet
    const fullTweet = buildFullTweetText(
      post.tweet_text,
      post.hashtags || [],
      post.image_ref.gallery_image_id
    );

    // Get image URL
    let imageUrl = post.image_data.cropped_url;
    if (imageUrl.startsWith('/')) {
      imageUrl = `https://sourcelibrary.org${imageUrl}`;
    }

    try {
      // Post to Twitter
      const result = await postTweetWithMedia(fullTweet, imageUrl);

      // Update post record
      await db.collection('social_posts').updateOne(
        { id: post.id },
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
        }
      );

      stats.posted++;
      logger.action('posted', 1);

      response = NextResponse.json({
        success: true,
        message: 'Posted successfully',
        postId: post.id,
        tweetUrl: result.tweetUrl,
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    } catch (twitterError) {
      console.error('Twitter API error in cron:', twitterError);

      // Update post with error
      await db.collection('social_posts').updateOne(
        { id: post.id },
        {
          $set: {
            status: 'failed',
            error: twitterError instanceof Error ? twitterError.message : 'Twitter API error',
            updated_at: new Date(),
          },
        }
      );

      stats.failed++;
      logger.action('failed', 1);
      logger.error(twitterError instanceof Error ? twitterError.message : 'Twitter API error');

      response = NextResponse.json({
        success: false,
        message: 'Failed to post',
        postId: post.id,
        error: twitterError instanceof Error ? twitterError.message : 'Unknown error',
        stats,
        duration_ms: logger.durationMs,
      });
      return response;
    }
  } catch (error) {
    console.error('Social post cron error:', error);
    logger.error(error instanceof Error ? error.message : 'Cron job failed');
    logger.setFailed();
    response = NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Cron job failed',
        stats,
        duration_ms: logger.durationMs,
      },
      { status: 500 }
    );
    return response;
  } finally {
    logger.setActions(stats);
    await logger.flush();
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
