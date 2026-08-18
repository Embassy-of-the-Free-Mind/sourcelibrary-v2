import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 10;

/**
 * GET /api/errors — admin-only: list recent errors for inspection.
 */
export const GET = withAdminAuth(async (request) => {
  try {
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '100'), 500);
    const db = await getDb();
    const errors = await db.collection('application_errors')
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    const total = await db.collection('application_errors').estimatedDocumentCount();
    return NextResponse.json({ errors, total });
  } catch (error) {
    console.error('[errors] Failed to fetch errors:', error);
    return NextResponse.json({ error: 'Failed to fetch errors' }, { status: 500 });
  }
});

/**
 * POST /api/errors
 *
 * Receives client-side error reports. Fire-and-forget from the browser.
 * Stores in `application_errors` collection for visibility into user-facing issues.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, stack, source, url, userAgent, componentStack } = body;

    if (!message) {
      return NextResponse.json({ error: 'message required' }, { status: 400 });
    }

    // Drop opaque cross-origin noise. Browsers report errors thrown by
    // third-party scripts (extensions, embeds, ad/analytics tags) as the bare
    // string "Script error." with no stack or source — they're not our bugs and
    // not actionable, yet they were ~75% of all logged errors (1.6k/day), burying
    // the real ones. Accept the report (ok) but don't store it.
    const msg = String(message).trim();
    if (/^Script error\.?$/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'noise' });
    }

    // Bound the write. This endpoint is public, unauthenticated, and its traffic
    // RISES exactly when the database is unhealthy (every failing page reports).
    // With no deadline each request holds a connection for the full maxDuration,
    // so a stampede converts into connection-pool exhaustion — which is how
    // 2026-08-18 took out unrelated API routes and production builds. Failing a
    // log write fast is strictly better than holding a connection to complete it.
    const db = await getDb();
    await db.collection('application_errors').insertOne({
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 5000) : undefined,
      component_stack: componentStack ? String(componentStack).slice(0, 2000) : undefined,
      source: source || 'unknown',
      url: url ? String(url).slice(0, 500) : undefined,
      user_agent: userAgent ? String(userAgent).slice(0, 500) : undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip'),
      timestamp: new Date(),
    }, { maxTimeMS: 2000 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[errors] Failed to log error:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
