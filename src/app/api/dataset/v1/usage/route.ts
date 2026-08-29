import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { validateApiKey } from '@/lib/dataset/api-keys';

/**
 * GET /api/dataset/v1/usage — a key holder's own usage, from the same ledger
 * the admin view reads (api_usage). Auth: a session (returns usage for all of
 * the user's keys) or a Bearer key (returns that key's usage).
 *
 * Query: ?days=30 (max 90)
 *
 * Part of #4366: partners could pull thousands of pages and have no way to
 * see their own meter.
 */
export async function GET(request: NextRequest) {
  const db = await getDb();

  let keyIds: string[] = [];
  const keyDoc = await validateApiKey(request.headers.get('authorization'));
  if (keyDoc) {
    keyIds = [String(keyDoc._id)];
  } else {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authenticate with your API key (Authorization: Bearer sl_data_…) or sign in.' },
        { status: 401 },
      );
    }
    const keys = await db.collection('api_keys')
      .find({ user_id: session.user.id })
      .project({ _id: 1 })
      .toArray();
    keyIds = keys.map((k) => String(k._id));
  }

  if (keyIds.length === 0) {
    return NextResponse.json({ days: 0, keys: [], note: 'No API keys on this account.' });
  }

  const days = Math.min(Number(request.nextUrl.searchParams.get('days')) || 30, 90);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const rows = await db.collection('api_usage').aggregate([
    { $match: { api_key_id: { $in: keyIds }, ts: { $gte: since } } },
    {
      $group: {
        _id: { key: '$api_key_id', route: '$route', day: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } } },
        requests: { $sum: 1 },
        pages: { $sum: '$pages_served' },
        blocked: { $sum: { $cond: ['$blocked', 1, 0] } },
      },
    },
    { $sort: { '_id.day': -1 } },
  ]).toArray();

  const byKey: Record<string, { key_id: string; total_requests: number; total_pages: number; blocked: number; daily: Array<{ day: string; route: string; requests: number; pages: number }> }> = {};
  for (const id of keyIds) {
    byKey[id] = { key_id: id, total_requests: 0, total_pages: 0, blocked: 0, daily: [] };
  }
  for (const r of rows) {
    const k = byKey[r._id.key];
    if (!k) continue;
    k.total_requests += r.requests;
    k.total_pages += r.pages;
    k.blocked += r.blocked;
    k.daily.push({ day: r._id.day, route: r._id.route, requests: r.requests, pages: r.pages });
  }

  return NextResponse.json({ days, since: since.toISOString(), keys: Object.values(byKey) });
}
