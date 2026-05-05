import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

interface CostAgg {
  total_cost_usd: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface ErrorAgg {
  _id: string;
  count: number;
  latest_message: string | null;
}

interface VelocityAgg {
  _id: { date: string; type: string };
  pages: number;
}

/**
 * Fetch gemini_usage rows from Supabase (primary store since 2026-04-10) for a
 * time window and optional status filter. Falls back to MongoDB at build time
 * when the service-role key isn't available.
 */
async function fetchUsageRows(
  db: Awaited<ReturnType<typeof getDb>>,
  since: Date,
  status?: 'success' | 'failed',
): Promise<Array<{
  status: string | null;
  type: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  page_count: number | null;
  timestamp: string | Date;
  error_category: string | null;
  error_message: string | null;
}>> {
  if (supabaseAdmin) {
    let query = supabaseAdmin
      .from('gemini_usage')
      .select('status, type, cost_usd, input_tokens, output_tokens, page_count, timestamp, error_category, error_message')
      .gte('timestamp', since.toISOString())
      .limit(50000);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) {
      console.warn('[processing-dashboard] Supabase usage query failed:', error.message);
      return [];
    }
    return (data || []) as Array<{
      status: string | null;
      type: string | null;
      cost_usd: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      page_count: number | null;
      timestamp: string;
      error_category: string | null;
      error_message: string | null;
    }>;
  }
  // Fallback: MongoDB (legacy stub)
  const match: Record<string, unknown> = { timestamp: { $gte: since } };
  if (status) match.status = status;
  const docs = await db.collection('gemini_usage')
    .find(match, {
      projection: {
        status: 1, type: 1, cost_usd: 1, input_tokens: 1, output_tokens: 1,
        page_count: 1, timestamp: 1, error_category: 1, error_message: 1,
      },
    })
    .limit(50000)
    .toArray();
  return docs.map(d => ({
    status: (d.status as string | null) ?? null,
    type: (d.type as string | null) ?? null,
    cost_usd: (d.cost_usd as number | null) ?? null,
    input_tokens: (d.input_tokens as number | null) ?? null,
    output_tokens: (d.output_tokens as number | null) ?? null,
    page_count: (d.page_count as number | null) ?? null,
    timestamp: d.timestamp as string | Date,
    error_category: (d.error_category as string | null) ?? null,
    error_message: (d.error_message as string | null) ?? null,
  }));
}

function aggregateCosts(rows: Array<{ cost_usd: number | null; input_tokens: number | null; output_tokens: number | null }>): CostAgg {
  const agg: CostAgg = { total_cost_usd: 0, total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 };
  for (const r of rows) {
    agg.total_calls++;
    agg.total_cost_usd += r.cost_usd ?? 0;
    agg.total_input_tokens += r.input_tokens ?? 0;
    agg.total_output_tokens += r.output_tokens ?? 0;
  }
  return agg;
}

export const maxDuration = 60;

/**
 * Processing Dashboard
 * GET /api/admin/processing-dashboard
 *
 * Returns campaign-level metrics:
 * - Progress: Books by OCR/translation completion tier (from cached book fields)
 * - Costs: Total spend this week/month from gemini_usage
 * - Errors: Top error categories (last 7 days)
 * - Velocity: Pages processed per day (last 7 days)
 */
export const GET = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider'); // Optional: filter by image_source.provider

    const db = await getDb();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // --- Run all queries in parallel ---
    const bookMatch: Record<string, unknown> = {};
    if (provider) {
      bookMatch['image_source.provider'] = provider;
    }

    const [booksWithStats, weekRows, monthRows, weekFailedRows] = await Promise.all([
      // Progress: use cached pages_count/pages_ocr/pages_translated from books
      // (refreshed every 6h by sync-page-counts cron, updated inline by workers)
      db.collection('books')
        .find(bookMatch, {
          projection: {
            pages_count: 1, pages_ocr: 1, pages_translated: 1,
          }
        })
        .toArray(),

      // Last 7 days: all rows for cost + velocity (filter by status in JS)
      fetchUsageRows(db, sevenDaysAgo),

      // Last 30 days: all rows for cost
      fetchUsageRows(db, thirtyDaysAgo),

      // Errors: failed rows only (last 7 days)
      fetchUsageRows(db, sevenDaysAgo, 'failed'),
    ]);

    const weekCostsAgg = aggregateCosts(weekRows);
    const monthCostsAgg = aggregateCosts(monthRows);

    // Errors: group by error_category, keep latest message
    const errorGroups = new Map<string, { count: number; latest_ts: number; latest_message: string | null }>();
    for (const r of weekFailedRows) {
      const key = r.error_category || 'unknown';
      const ts = new Date(r.timestamp).getTime();
      const existing = errorGroups.get(key);
      if (existing) {
        existing.count++;
        if (ts > existing.latest_ts) {
          existing.latest_ts = ts;
          existing.latest_message = r.error_message;
        }
      } else {
        errorGroups.set(key, { count: 1, latest_ts: ts, latest_message: r.error_message });
      }
    }
    const errorStats: ErrorAgg[] = Array.from(errorGroups.entries())
      .map(([_id, v]) => ({ _id, count: v.count, latest_message: v.latest_message }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Velocity: pages per day per type (success only)
    const velocityGroups = new Map<string, { date: string; type: string; pages: number }>();
    for (const r of weekRows) {
      if (r.status !== 'success') continue;
      const ts = typeof r.timestamp === 'string' ? r.timestamp : r.timestamp.toISOString();
      const date = ts.slice(0, 10);
      const type = r.type || 'unknown';
      const key = `${date}|${type}`;
      const existing = velocityGroups.get(key);
      // Match Mongo $ifNull behaviour: count 1 page if page_count is missing.
      const pages = r.page_count ?? 1;
      if (existing) {
        existing.pages += pages;
      } else {
        velocityGroups.set(key, { date, type, pages });
      }
    }
    const velocityStats: VelocityAgg[] = Array.from(velocityGroups.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(v => ({ _id: { date: v.date, type: v.type }, pages: v.pages }));

    // Bucket books into tiers using cached fields
    function getTier(pct: number): string {
      if (pct === 0) return '0%';
      if (pct < 50) return '1-49%';
      if (pct < 100) return '50-99%';
      return '100%';
    }

    const ocrTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };
    const transTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };

    for (const book of booksWithStats) {
      const total = (book.pages_count as number) || 0;
      const ocr = (book.pages_ocr as number) || 0;
      const trans = (book.pages_translated as number) || 0;
      const ocrPct = total > 0 ? (ocr / total) * 100 : 0;
      const transPct = total > 0 ? (trans / total) * 100 : 0;
      ocrTiers[getTier(ocrPct)]++;
      transTiers[getTier(transPct)]++;
    }

    const progress = {
      total_books: booksWithStats.length,
      ocr: ocrTiers,
      translation: transTiers,
    };

    // Format costs
    const costs = {
      last_7_days: weekCostsAgg,
      last_30_days: monthCostsAgg,
    };

    // Format errors
    const errors = errorStats.map(e => ({
      category: e._id,
      count: e.count,
      latest_message: e.latest_message,
    }));

    // Format velocity: { "2025-01-15": { ocr: 50, translate: 30 }, ... }
    const velocity: Record<string, Record<string, number>> = {};
    for (const v of velocityStats) {
      const date = v._id.date;
      if (!velocity[date]) velocity[date] = {};
      velocity[date][v._id.type] = v.pages;
    }

    return NextResponse.json({
      generated_at: now.toISOString(),
      provider_filter: provider || 'all',
      progress,
      costs,
      errors,
      velocity,
    });
  } catch (error) {
    console.error('[processing-dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate dashboard' },
      { status: 500 }
    );
  }
});
