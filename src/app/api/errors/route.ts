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
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[errors] Failed to log error:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
