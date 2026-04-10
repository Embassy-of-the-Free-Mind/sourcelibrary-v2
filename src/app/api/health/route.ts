import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/health — lightweight health check for uptime monitoring.
 * No auth required. Returns 200 if the app + MongoDB are reachable.
 */
export async function GET() {
  try {
    const db = await getReadDb();
    // Minimal ping — don't query a large collection
    await db.command({ ping: 1 });

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[health] MongoDB ping failed:', error);
    return NextResponse.json(
      { status: 'error', error: 'Database unreachable' },
      { status: 503 }
    );
  }
}
