/**
 * Social Media Configuration API
 *
 * GET /api/social/config - Get current config and usage stats
 * PATCH /api/social/config - Update settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { isTwitterConfigured, verifyCredentials } from '@/lib/twitter';
import { SocialConfig } from '@/lib/types';

const DEFAULT_CONFIG: Omit<SocialConfig, '_id' | 'updated_at'> = {
  platform: 'twitter',
  settings: {
    posts_per_day: 2,
    posting_hours: [14, 20], // 2pm and 8pm UTC
    auto_post_enabled: false,
    min_gallery_quality: 0.75,
  },
  usage: {
    tweets_today: 0,
    tweets_this_month: 0,
  },
};

/**
 * GET /api/social/config
 * Returns config, usage stats, and Twitter connection status
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get or create config
    const existingConfig = await db.collection('social_config').findOne({ platform: 'twitter' });

    const config = existingConfig ?? {
      ...DEFAULT_CONFIG,
      updated_at: new Date(),
    };

    if (!existingConfig) {
      // Create default config
      await db.collection('social_config').insertOne({ ...config });
    }

    // Check Twitter connection
    const twitterConfigured = isTwitterConfigured();
    let twitterConnected = false;
    let twitterUsername: string | undefined;

    if (twitterConfigured) {
      try {
        const verification = await verifyCredentials();
        twitterConnected = verification.valid;
        twitterUsername = verification.username;
      } catch {
        twitterConnected = false;
      }
    }

    // Get queue stats
    const queueStats = await db.collection('social_posts').aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const stats = {
      draft: 0,
      queued: 0,
      posted: 0,
      failed: 0,
    };
    for (const stat of queueStats) {
      if (stat._id in stats) {
        stats[stat._id as keyof typeof stats] = stat.count;
      }
    }

    return NextResponse.json({
      config: {
        platform: config.platform,
        settings: config.settings,
        usage: config.usage,
        updated_at: config.updated_at,
      },
      twitter: {
        configured: twitterConfigured,
        connected: twitterConnected,
        username: twitterUsername,
      },
      stats,
    });
  } catch (error) {
    console.error('Error getting social config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get config' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/social/config
 * Update settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings) {
      return NextResponse.json(
        { error: 'No settings provided' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Validate settings
    const update: Partial<SocialConfig['settings']> = {};

    if (typeof settings.posts_per_day === 'number') {
      update.posts_per_day = Math.max(1, Math.min(50, settings.posts_per_day));
    }

    if (Array.isArray(settings.posting_hours)) {
      update.posting_hours = settings.posting_hours
        .filter((h: unknown) => typeof h === 'number' && h >= 0 && h < 24)
        .sort((a: number, b: number) => a - b);
    }

    if (typeof settings.auto_post_enabled === 'boolean') {
      update.auto_post_enabled = settings.auto_post_enabled;
    }

    if (typeof settings.min_gallery_quality === 'number') {
      update.min_gallery_quality = Math.max(0, Math.min(1, settings.min_gallery_quality));
    }

    // Update config
    const result = await db.collection('social_config').findOneAndUpdate(
      { platform: 'twitter' },
      {
        $set: {
          ...Object.fromEntries(
            Object.entries(update).map(([k, v]) => [`settings.${k}`, v])
          ),
          updated_at: new Date(),
        },
        $setOnInsert: {
          platform: 'twitter',
          usage: DEFAULT_CONFIG.usage,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    return NextResponse.json({
      success: true,
      config: result,
    });
  } catch (error) {
    console.error('Error updating social config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update config' },
      { status: 500 }
    );
  }
}
