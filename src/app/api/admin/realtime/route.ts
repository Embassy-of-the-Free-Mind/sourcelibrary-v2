import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

// Shapes returned by the gemini_usage queries below. Both Supabase + MongoDB
// branches normalize to these shapes so downstream code stays unchanged.
type UsageByTypeRow = {
  _id: { type: string | null; status: string | null };
  count: number;
  cost: number;
  tokens: number;
};

type UsageByMinuteRow = {
  _id: { minute: string; type: string };
  count: number;
};

type RecentActivityRow = {
  type?: string | null;
  status?: string | null;
  book_id?: string | null;
  model?: string | null;
  cost_usd?: number | null;
  timestamp: string | Date;
};

export const maxDuration = 15;

/**
 * GET /api/admin/realtime
 * Fast snapshot of what's happening right now in the pipeline.
 * Designed for polling every 10-30s.
 */
export const GET = withAdminAuth(async (request, session) => {
  try {
    const db = await getDb();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    const [
      activeJobs,
      activeBatchJobs,
      usageByType,
      usageByMinute,
      pipelineFunnel,
      recentActivity,
      recentCompletions,
    ] = await Promise.all([
      // 1. Active Lambda jobs with progress
      db.collection('jobs')
        .find(
          { status: { $in: ['pending', 'processing'] } },
          {
            projection: {
              id: 1, type: 1, status: 1, book_id: 1, book_title: 1,
              progress: 1, config: { model: 1, language: 1 },
              created_at: 1, updated_at: 1,
            },
          }
        )
        .sort({ updated_at: -1 })
        .limit(50)
        .toArray(),

      // 2. Active batch jobs
      db.collection('batch_jobs')
        .find(
          { status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] } },
          {
            projection: {
              id: 1, type: 1, status: 1, book_id: 1, page_count: 1,
              model: 1, created_at: 1, updated_at: 1,
              progress: 1,
            },
          }
        )
        .sort({ created_at: -1 })
        .limit(50)
        .toArray(),

      // 3. Gemini usage last hour by type+status
      // Supabase is the primary store since 2026-04-10 (issue #567 Phase 3).
      // Aggregate in JS — PostgREST has no GROUP BY equivalent.
      (async (): Promise<UsageByTypeRow[]> => {
        if (supabaseAdmin) {
          const { data, error } = await supabaseAdmin
            .from('gemini_usage')
            .select('type, status, cost_usd, input_tokens, output_tokens')
            .gte('timestamp', oneHourAgo.toISOString())
            .limit(50000);
          if (error) {
            console.warn('[admin/realtime] Supabase usageByType failed:', error.message);
            return [];
          }
          const groups = new Map<string, UsageByTypeRow>();
          for (const r of data || []) {
            const key = `${r.type ?? 'null'}|${r.status ?? 'null'}`;
            const existing = groups.get(key);
            const tokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
            if (existing) {
              existing.count++;
              existing.cost += r.cost_usd ?? 0;
              existing.tokens += tokens;
            } else {
              groups.set(key, {
                _id: { type: r.type ?? null, status: r.status ?? null },
                count: 1,
                cost: r.cost_usd ?? 0,
                tokens,
              });
            }
          }
          return Array.from(groups.values()).sort((a, b) => b.count - a.count);
        }
        return db.collection('gemini_usage').aggregate([
          { $match: { timestamp: { $gte: oneHourAgo } } },
          {
            $group: {
              _id: { type: '$type', status: '$status' },
              count: { $sum: 1 },
              cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
              tokens: { $sum: { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] } },
            },
          },
          { $sort: { count: -1 } },
        ]).toArray() as Promise<UsageByTypeRow[]>;
      })(),

      // 4. Throughput: pages processed per minute (last 30 min)
      (async (): Promise<UsageByMinuteRow[]> => {
        const cutoff = new Date(Date.now() - 30 * 60 * 1000);
        if (supabaseAdmin) {
          const { data, error } = await supabaseAdmin
            .from('gemini_usage')
            .select('type, timestamp')
            .gte('timestamp', cutoff.toISOString())
            .eq('status', 'success')
            .limit(50000);
          if (error) {
            console.warn('[admin/realtime] Supabase usageByMinute failed:', error.message);
            return [];
          }
          const groups = new Map<string, UsageByMinuteRow>();
          for (const r of data || []) {
            // timestamp comes back as ISO; format as HH:MM in UTC to match the
            // MongoDB $dateToString default (which is UTC).
            const ts = new Date(r.timestamp);
            const minute = `${String(ts.getUTCHours()).padStart(2, '0')}:${String(ts.getUTCMinutes()).padStart(2, '0')}`;
            const type = r.type ?? 'unknown';
            const key = `${minute}|${type}`;
            const existing = groups.get(key);
            if (existing) {
              existing.count++;
            } else {
              groups.set(key, { _id: { minute, type }, count: 1 });
            }
          }
          return Array.from(groups.values()).sort((a, b) => a._id.minute.localeCompare(b._id.minute));
        }
        return db.collection('gemini_usage').aggregate([
          { $match: { timestamp: { $gte: cutoff }, status: 'success' } },
          {
            $group: {
              _id: {
                minute: { $dateToString: { format: '%H:%M', date: '$timestamp' } },
                type: '$type',
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.minute': 1 } },
        ]).toArray() as Promise<UsageByMinuteRow[]>;
      })(),

      // 5. Pipeline funnel
      db.collection('books').aggregate([
        { $match: { 'pipeline_auto.status': { $exists: true } } },
        { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),

      // 6. Most recent AI calls (activity feed)
      (async (): Promise<RecentActivityRow[]> => {
        if (supabaseAdmin) {
          const { data, error } = await supabaseAdmin
            .from('gemini_usage')
            .select('type, status, book_id, model, cost_usd, timestamp')
            .gte('timestamp', fiveMinAgo.toISOString())
            .order('timestamp', { ascending: false })
            .limit(30);
          if (error) {
            console.warn('[admin/realtime] Supabase recentActivity failed:', error.message);
            return [];
          }
          return (data || []) as RecentActivityRow[];
        }
        const docs = await db.collection('gemini_usage')
          .find(
            { timestamp: { $gte: fiveMinAgo } },
            {
              projection: {
                type: 1, status: 1, book_id: 1, model: 1,
                cost_usd: 1, timestamp: 1,
              },
            }
          )
          .sort({ timestamp: -1 })
          .limit(30)
          .toArray();
        return docs as unknown as RecentActivityRow[];
      })(),

      // 7. Recently completed books (pipeline reached 'complete' in last 2 hours)
      db.collection('books')
        .find(
          {
            'pipeline_auto.status': 'complete',
            'pipeline_auto.completed_at': { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          { projection: { id: 1, title: 1, display_title: 1, 'pipeline_auto.completed_at': 1, pages_count: 1 } }
        )
        .sort({ 'pipeline_auto.completed_at': -1 })
        .limit(10)
        .toArray(),
    ]);

    // Compute hourly totals
    const hourlyTotals: Record<string, { count: number; cost: number }> = {};
    for (const u of usageByType as any[]) {
      const type = u._id.type || 'unknown';
      if (!hourlyTotals[type]) hourlyTotals[type] = { count: 0, cost: 0 };
      hourlyTotals[type].count += u.count;
      hourlyTotals[type].cost += u.cost;
    }

    // Compute throughput per minute
    const throughput: Record<string, Record<string, number>> = {};
    for (const m of usageByMinute as any[]) {
      const min = m._id.minute;
      const type = m._id.type;
      if (!throughput[min]) throughput[min] = {};
      throughput[min][type] = m.count;
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      activeJobs: (activeJobs as any[]).map(j => ({
        id: j.id,
        type: j.type,
        status: j.status,
        bookId: j.book_id,
        bookTitle: j.book_title,
        progress: j.progress,
        model: j.config?.model,
        language: j.config?.language,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
      })),
      activeBatchJobs: (activeBatchJobs as any[]).map(j => ({
        id: j.id,
        type: j.type,
        status: j.status,
        bookId: j.book_id,
        pageCount: j.page_count,
        model: j.model,
        progress: j.progress,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
      })),
      hourly: {
        byType: Object.entries(hourlyTotals).map(([type, v]) => ({ type, ...v })),
        totalCalls: Object.values(hourlyTotals).reduce((s, v) => s + v.count, 0),
        totalCost: Object.values(hourlyTotals).reduce((s, v) => s + v.cost, 0),
      },
      throughput: Object.entries(throughput)
        .map(([minute, types]) => ({ minute, ...types }))
        .sort((a, b) => a.minute.localeCompare(b.minute)),
      pipelineFunnel: (pipelineFunnel as any[]).map(s => ({
        status: s._id || 'not_enrolled',
        count: s.count,
      })),
      recentActivity: (recentActivity as any[]).map(a => ({
        type: a.type,
        status: a.status,
        bookId: a.book_id,
        model: a.model,
        cost: a.cost_usd,
        timestamp: a.timestamp,
      })),
      recentCompletions: (recentCompletions as any[]).map(b => ({
        id: b.id,
        title: b.display_title || b.title,
        completedAt: b.pipeline_auto?.completed_at,
        pages: b.pages_count,
      })),
    });
  } catch (error) {
    console.error('Realtime dashboard error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
