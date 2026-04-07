import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * GET /api/status
 *
 * Lightweight public health endpoint for uptime monitors (UptimeRobot, Betterstack, etc.).
 * Returns HTTP 200 for healthy, 503 for unhealthy.
 * No auth required. No sensitive data exposed.
 */
export async function GET() {
  const started = Date.now();
  const latency: Record<string, number> = {};
  let status: 'ok' | 'degraded' | 'down' = 'ok';

  // 1. MongoDB ping
  let db;
  try {
    db = await getDb();
    const t = Date.now();
    await db.command({ ping: 1 });
    latency.db_ping = Date.now() - t;
    if (latency.db_ping > 500) status = 'degraded';
  } catch {
    status = 'down';
    return NextResponse.json(
      {
        status: 'down',
        latency: {},
        timestamp: new Date().toISOString(),
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  // 2. Fast book query (lightweight — just confirms reads work)
  try {
    const t = Date.now();
    await db.collection('books')
      .findOne(
        { visible: true },
        { projection: { id: 1 }, maxTimeMS: 5000 } as any
      );
    latency.book_query = Date.now() - t;
    if (latency.book_query > 2000) status = 'degraded';
  } catch {
    status = 'degraded';
  }

  return NextResponse.json(
    {
      status,
      latency,
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev',
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
