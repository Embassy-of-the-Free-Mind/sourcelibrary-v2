import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/admin/api-keys/usage — Usage stats for all API keys
 *
 * Query: ?days=30 (default 30, max 90)
 *
 * Returns per-key totals and daily breakdown.
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const days = Math.min(Number(url.searchParams.get('days')) || 30, 90);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get all active keys for reference
  const keys = await db.collection('api_keys')
    .find({})
    .project({ key_hash: 0 })
    .sort({ created_at: -1 })
    .toArray();

  // Per-key usage comes from api_usage — the log EVERY gated surface writes
  // (withApiAuth routes, MCP, /text, /quote, the image proxy). This route
  // previously read only dataset_usage_daily/dataset_access_log, which the
  // bulk-dump route alone writes, so every other key showed ZERO usage here
  // (#4366 finding — the instrument error behind "the key was never used").
  const dailyUsage = await db.collection('api_usage')
    .aggregate([
      { $match: { api_key_id: { $ne: null }, ts: { $gte: since } } },
      {
        $group: {
          _id: { key: '$api_key_id', day: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } } },
          requests: { $sum: 1 },
          pages_served: { $sum: '$pages_served' },
        },
      },
      { $sort: { '_id.day': -1 } },
    ])
    .toArray();

  // Route breakdown from the same log, plus the dataset bulk endpoints from
  // their compliance log (they don't write api_usage).
  const endpointBreakdown = await db.collection('api_usage')
    .aggregate([
      { $match: { api_key_id: { $ne: null }, ts: { $gte: since } } },
      {
        $group: {
          _id: { api_key_id: '$api_key_id', endpoint: '$route' },
          requests: { $sum: 1 },
          pages_served: { $sum: '$pages_served' },
        },
      },
    ])
    .toArray();
  const datasetBreakdown = await db.collection('dataset_access_log')
    .aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: { api_key_id: '$api_key_id', endpoint: { $concat: ['dataset/', '$endpoint'] } },
          requests: { $sum: 1 },
          pages_served: { $sum: '$records_returned' },
        },
      },
    ])
    .toArray();
  endpointBreakdown.push(...datasetBreakdown);

  // Build per-key summaries
  const keyMap = new Map(keys.map(k => [k._id.toString(), k]));
  const summaries: Record<string, {
    key_id: string;
    name: string;
    user_id: string;
    tier: string;
    status: string;
    created_at: string;
    last_used_at: string | null;
    total_requests: number;
    total_pages: number;
    endpoints: Record<string, { requests: number; pages: number }>;
    daily: Array<{ date: string; requests: number; pages: number }>;
  }> = {};

  // Initialize from keys
  for (const k of keys) {
    summaries[k._id.toString()] = {
      key_id: k._id.toString(),
      name: k.name,
      user_id: k.user_id,
      tier: k.tier,
      status: k.status,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
      total_requests: 0,
      total_pages: 0,
      endpoints: {},
      daily: [],
    };
  }

  // Fill daily usage from api_usage…
  for (const d of dailyUsage) {
    const keyId = d._id?.key?.toString();
    if (!summaries[keyId]) continue;
    summaries[keyId].total_requests += d.requests || 0;
    summaries[keyId].total_pages += d.pages_served || 0;
    summaries[keyId].daily.push({
      date: d._id.day,
      requests: d.requests || 0,
      pages: d.pages_served || 0,
    });
  }
  // …and merge the dataset bulk route's own daily counters (it logs to its
  // compliance collections, not api_usage).
  const datasetDaily = await db.collection('dataset_usage_daily')
    .find({ date: { $gte: since } })
    .sort({ date: -1 })
    .toArray();
  for (const d of datasetDaily) {
    const keyId = d.api_key_id?.toString();
    if (!summaries[keyId]) continue;
    summaries[keyId].total_requests += d.requests || 0;
    summaries[keyId].total_pages += d.pages_served || 0;
    summaries[keyId].daily.push({
      date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : String(d._id).split(':')[1],
      requests: d.requests || 0,
      pages: d.pages_served || 0,
    });
  }

  // Fill endpoint breakdown
  for (const e of endpointBreakdown) {
    const keyId = e._id.api_key_id?.toString();
    if (!summaries[keyId]) continue;
    summaries[keyId].endpoints[e._id.endpoint] = {
      requests: e.requests,
      pages: e.pages_served,
    };
  }

  // Global totals
  const totals = {
    total_requests: Object.values(summaries).reduce((s, k) => s + k.total_requests, 0),
    total_pages: Object.values(summaries).reduce((s, k) => s + k.total_pages, 0),
    active_keys: keys.filter(k => k.status === 'active').length,
    total_keys: keys.length,
  };

  return NextResponse.json({
    days,
    since: since.toISOString(),
    totals,
    keys: Object.values(summaries).sort((a, b) => b.total_requests - a.total_requests),
  });
});
