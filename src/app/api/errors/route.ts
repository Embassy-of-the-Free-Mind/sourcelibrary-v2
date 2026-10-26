import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { recurringErrors } from '@/lib/error-rollup';

export const maxDuration = 10;

/**
 * GET /api/errors — admin-only: list recent errors for inspection.
 *
 * `?rollup=<days>` (1–30) returns the recurring-error rollup instead: the window's rows
 * grouped by normalised message, with count, distinct visitors, first/last seen and an
 * example URL (#4057). `min` sets the per-group threshold (default 10), `limit` the
 * number of groups (default 25). This is what the weekly digest routine reads.
 *
 * `?daily=<days>` (1–90) returns per-day counts in three kinds for the admin chart:
 * `crash` (an error boundary drew an error screen), `browser` (other client errors) and
 * `server`. Each day also carries `crash_visitors`, distinct IPs that saw an error screen.
 * "failed to pipe response" is left out of `server`: it is a client hanging up mid-stream.
 */
export const GET = withAdminAuth(async (request) => {
  try {
    const params = request.nextUrl.searchParams;
    if (params.has('daily')) {
      const days = Math.min(Math.max(Number(params.get('daily')) || 30, 1), 90);
      const db = await getDb();
      const since = new Date(Date.now() - days * 86400_000);
      const rows = await db.collection('application_errors').aggregate([
        { $match: { timestamp: { $gte: since }, message: { $ne: 'failed to pipe response' } } },
        {
          $project: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            ip: 1,
            kind: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: { $ifNull: ['$source', ''] }, regex: /error_boundary/ } }, then: 'crash' },
                  { case: { $regexMatch: { input: { $ifNull: ['$source', ''] }, regex: /^server_/ } }, then: 'server' },
                ],
                default: 'browser',
              },
            },
          },
        },
        { $group: { _id: { day: '$day', kind: '$kind' }, n: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
      ], { maxTimeMS: 8000 }).toArray();
      const byDay = new Map<string, { day: string; crash: number; browser: number; server: number; crash_visitors: number }>();
      for (let t = since.getTime(); t <= Date.now(); t += 86400_000) {
        const day = new Date(t).toISOString().slice(0, 10);
        byDay.set(day, { day, crash: 0, browser: 0, server: 0, crash_visitors: 0 });
      }
      for (const r of rows) {
        const entry = byDay.get(r._id.day);
        if (!entry) continue;
        entry[r._id.kind as 'crash' | 'browser' | 'server'] = r.n;
        if (r._id.kind === 'crash') entry.crash_visitors = r.ips.length;
      }
      return NextResponse.json({ days: [...byDay.values()] });
    }
    if (params.has('rollup')) {
      const db = await getDb();
      return NextResponse.json(await recurringErrors(db, {
        windowDays: Number(params.get('rollup')) || 7,
        minCount: Number(params.get('min')) || 10,
        limit: Number(params.get('limit')) || 25,
      }));
    }
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

    // Same rationale for errors thrown inside browser extensions: the stack
    // frames live entirely in extension code, not ours. One translation
    // extension alone logged 2.6k errors/week ("reading 'M_ID'") against
    // /collections pages. Keep reports whose stack also touches our code —
    // an extension frame wrapping a real sourcelibrary frame stays loggable.
    const stackStr = stack ? String(stack) : '';
    if (
      /(?:chrome|moz|safari|safari-web)-extension:\/\//.test(stackStr) &&
      !/sourcelibrary\.org|\/_next\//.test(stackStr)
    ) {
      return NextResponse.json({ ok: true, skipped: 'extension' });
    }

    // Runaway recursion inside a script the iOS in-app browsers inject (#7437).
    // Chrome for iOS (CriOS) and the Google app (GSA) are WKWebView shells that
    // add their own user scripts to every page; WebKit reports those frames
    // against the PAGE url with invented line numbers (":193:70", ":229:409")
    // and minified names that alternate (Hk/Fk, $k/Yk). Our served HTML is 12
    // lines and contains none of those names, and none of the frames is a
    // /_next/ chunk. 4,020 of 4,257 stored rows were CriOS, 189 GSA. Keep any
    // report whose stack touches a /_next/ chunk: that would be our bundle.
    if (
      /Maximum call stack size exceeded/i.test(msg) &&
      /\b(?:CriOS|GSA|FxiOS|EdgiOS)\//.test(String(userAgent || '')) &&
      !/\/_next\//.test(stackStr)
    ) {
      return NextResponse.json({ ok: true, skipped: 'injected-webview' });
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
