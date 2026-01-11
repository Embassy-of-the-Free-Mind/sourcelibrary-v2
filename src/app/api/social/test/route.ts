/**
 * Twitter Connection Test
 * GET /api/social/test - Test Twitter credentials
 */

import { NextResponse } from 'next/server';
import { getTwitterClient, isTwitterConfigured, verifyCredentials } from '@/lib/twitter';

export async function GET() {
  try {
    // Check if configured
    const configured = isTwitterConfigured();

    if (!configured) {
      return NextResponse.json({
        configured: false,
        error: 'Twitter credentials not set',
        env: {
          hasApiKey: !!process.env.TWITTER_API_KEY,
          hasApiSecret: !!process.env.TWITTER_API_SECRET,
          hasAccessToken: !!process.env.TWITTER_ACCESS_TOKEN,
          hasAccessSecret: !!process.env.TWITTER_ACCESS_SECRET,
        }
      });
    }

    // Try to verify credentials
    const verification = await verifyCredentials();

    if (verification.valid) {
      return NextResponse.json({
        configured: true,
        connected: true,
        username: verification.username,
        message: 'Twitter credentials are valid!'
      });
    } else {
      return NextResponse.json({
        configured: true,
        connected: false,
        error: verification.error,
        env: {
          apiKeyLength: process.env.TWITTER_API_KEY?.length,
          apiSecretLength: process.env.TWITTER_API_SECRET?.length,
          accessTokenLength: process.env.TWITTER_ACCESS_TOKEN?.length,
          accessSecretLength: process.env.TWITTER_ACCESS_SECRET?.length,
        }
      });
    }
  } catch (error) {
    return NextResponse.json({
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}
