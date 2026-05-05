import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/usage
 *
 * Get Gemini API usage statistics
 *
 * Query params:
 * - start: ISO date string (default: 30 days ago)
 * - end: ISO date string (default: now)
 * - book_id: Filter by book
 * - group_by: 'day' | 'type' | 'model' | 'book' (default: summary only)
 *
 * Reads from Supabase `gemini_usage` (primary store since 2026-04-10, issue #567 Phase 3).
 * MongoDB `gemini_usage` is a near-empty stub now and is used only as a build-time
 * fallback when the Supabase service-role key isn't available.
 */
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('start')
      ? new Date(searchParams.get('start')!)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = searchParams.get('end')
      ? new Date(searchParams.get('end')!)
      : new Date();
    const bookId = searchParams.get('book_id');
    const groupBy = searchParams.get('group_by');

    interface UsageRow {
      type?: string | null;
      model?: string | null;
      status?: string | null;
      cost_usd?: number | null;
      input_tokens?: number | null;
      output_tokens?: number | null;
      page_count?: number | null;
      timestamp: string | Date;
      book_id?: string | null;
      book_title?: string | null;
    }

    let rows: UsageRow[] = [];

    if (supabaseAdmin) {
      let query = supabaseAdmin
        .from('gemini_usage')
        .select('type, model, status, cost_usd, input_tokens, output_tokens, page_count, timestamp, book_id, book_title')
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString())
        .limit(50000);
      if (bookId) query = query.eq('book_id', bookId);
      const { data, error } = await query;
      if (error) {
        console.warn('[usage] Supabase read failed:', error.message);
      }
      rows = (data || []) as UsageRow[];
    } else {
      // Build-time / no service key — fall back to MongoDB (legacy stub).
      const db = await getReadDb();
      const match: Record<string, unknown> = { timestamp: { $gte: startDate, $lte: endDate } };
      if (bookId) match.book_id = bookId;
      const docs = await db.collection('gemini_usage')
        .find(match, {
          projection: {
            type: 1, model: 1, status: 1, cost_usd: 1,
            input_tokens: 1, output_tokens: 1, page_count: 1,
            timestamp: 1, book_id: 1, book_title: 1,
          },
        })
        .limit(50000)
        .toArray();
      rows = docs as unknown as UsageRow[];
    }

    // Compute summary in JS
    const summary = {
      total_calls: 0,
      successful_calls: 0,
      failed_calls: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      total_pages: 0,
    };
    for (const r of rows) {
      summary.total_calls++;
      if (r.status === 'success') summary.successful_calls++;
      else if (r.status === 'failed') summary.failed_calls++;
      summary.total_input_tokens += r.input_tokens ?? 0;
      summary.total_output_tokens += r.output_tokens ?? 0;
      summary.total_cost_usd += r.cost_usd ?? 0;
      summary.total_pages += r.page_count ?? 0;
    }

    const result: Record<string, unknown> = {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
    };

    if (groupBy === 'day') {
      const groups = new Map<string, { calls: number; cost: number; pages: number }>();
      for (const r of rows) {
        // ISO date prefix (YYYY-MM-DD) — works for both string and Date timestamps.
        const ts = typeof r.timestamp === 'string' ? r.timestamp : r.timestamp.toISOString();
        const key = ts.slice(0, 10);
        const existing = groups.get(key);
        if (existing) {
          existing.calls++;
          existing.cost += r.cost_usd ?? 0;
          existing.pages += r.page_count ?? 0;
        } else {
          groups.set(key, { calls: 1, cost: r.cost_usd ?? 0, pages: r.page_count ?? 0 });
        }
      }
      result.by_day = Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }));
    }

    if (groupBy === 'type' || !groupBy) {
      const groups = new Map<string, { calls: number; cost: number; pages: number; input_tokens: number; output_tokens: number }>();
      for (const r of rows) {
        const key = r.type ?? 'unknown';
        const existing = groups.get(key);
        if (existing) {
          existing.calls++;
          existing.cost += r.cost_usd ?? 0;
          existing.pages += r.page_count ?? 0;
          existing.input_tokens += r.input_tokens ?? 0;
          existing.output_tokens += r.output_tokens ?? 0;
        } else {
          groups.set(key, {
            calls: 1,
            cost: r.cost_usd ?? 0,
            pages: r.page_count ?? 0,
            input_tokens: r.input_tokens ?? 0,
            output_tokens: r.output_tokens ?? 0,
          });
        }
      }
      result.by_type = Array.from(groups.entries())
        .map(([type, v]) => ({ type, ...v }))
        .sort((a, b) => b.cost - a.cost);
    }

    if (groupBy === 'model' || !groupBy) {
      const groups = new Map<string, { calls: number; cost: number; pages: number }>();
      for (const r of rows) {
        const key = r.model ?? 'unknown';
        const existing = groups.get(key);
        if (existing) {
          existing.calls++;
          existing.cost += r.cost_usd ?? 0;
          existing.pages += r.page_count ?? 0;
        } else {
          groups.set(key, { calls: 1, cost: r.cost_usd ?? 0, pages: r.page_count ?? 0 });
        }
      }
      result.by_model = Array.from(groups.entries())
        .map(([model, v]) => ({ model, ...v }))
        .sort((a, b) => b.cost - a.cost);
    }

    if (groupBy === 'book') {
      const groups = new Map<string, { book_id: string | null; book_title: string | null; calls: number; cost: number; pages: number }>();
      for (const r of rows) {
        const key = `${r.book_id ?? ''}|${r.book_title ?? ''}`;
        const existing = groups.get(key);
        if (existing) {
          existing.calls++;
          existing.cost += r.cost_usd ?? 0;
          existing.pages += r.page_count ?? 0;
        } else {
          groups.set(key, {
            book_id: r.book_id ?? null,
            book_title: r.book_title ?? null,
            calls: 1,
            cost: r.cost_usd ?? 0,
            pages: r.page_count ?? 0,
          });
        }
      }
      result.by_book = Array.from(groups.values())
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 50);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[usage] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage stats' },
      { status: 500 }
    );
  }
});
