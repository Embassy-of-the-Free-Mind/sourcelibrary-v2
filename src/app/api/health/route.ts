import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * GET /api/health — lightweight health check for uptime monitoring.
 * No auth required. Returns 200 if the app + MongoDB are reachable.
 */
export async function GET() {
  try {
    const db = await getDb();
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
