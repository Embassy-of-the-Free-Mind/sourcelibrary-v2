/**
 * Daily Social Media Counter Reset Cron Job
 *
 * POST /api/cron/social-reset
 *
 * Runs daily at midnight UTC to reset daily tweet counter.
 * Also resets monthly counter on the 1st of each month.
 *
 * Add to vercel.json crons: { path: "/api/cron/social-reset", schedule: "0 0 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const db = await getDb();
    const now = new Date();
    const isFirstOfMonth = now.getUTCDate() === 1;

    const update: Record<string, unknown> = {
      'usage.tweets_today': 0,
      updated_at: now,
    };

    // Reset monthly counter on 1st of month
    if (isFirstOfMonth) {
      update['usage.tweets_this_month'] = 0;
    }

    const result = await db.collection('social_config').updateOne(
      { platform: 'twitter' },
      { $set: update }
    );

    return NextResponse.json({
      success: true,
      reset: {
        daily: true,
        monthly: isFirstOfMonth,
      },
      modified: result.modifiedCount,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Social reset cron error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reset failed' },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
