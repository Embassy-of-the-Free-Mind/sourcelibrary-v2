import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { WIKIPEDIA_EVENT_ORDER } from '@/lib/review-queue';

export const maxDuration = 5;

/**
 * GET /api/contribute/wikipedia/state?volunteer_id=<uuid>
 *
 * Returns the current state of every Wikipedia playbook item, computed
 * from the volunteer_ratings event log (queue='wikipedia'):
 *   - `mine[item_id]`: the latest status this volunteer set
 *   - `global[item_id]`: aggregate { claimed_by, posted, merged, ... }
 *     so we can show "currently claimed by anon42, 12min ago"
 *   - `totals`: aggregate counters (across all volunteers)
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId || !/^[0-9a-f-]{36}$/i.test(volunteerId)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  // Pull every event for the wikipedia queue. Volume is small (one event per
  // claim/post/etc.); a single SELECT is fine for the foreseeable future.
  const { data, error } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('item_id,rating,volunteer_id,created_at,detail')
    .eq('queue', 'wikipedia')
    .order('created_at', { ascending: true })
    .limit(20000);

  if (error) {
    console.error('[wikipedia/state] select failed:', error);
    return NextResponse.json({ error: 'select failed' }, { status: 500 });
  }

  type Event = { item_id: string; rating: string; volunteer_id: string; created_at: string; detail: unknown };
  const events = (data ?? []) as Event[];

  // Aggregate state per item
  const global: Record<string, {
    latest_event?: string;
    claimed_by?: string;
    claimed_at?: string;
    posted_count: number;
    merged_count: number;
    declined_count: number;
  }> = {};
  const mine: Record<string, { latest_event: string; created_at: string; detail?: unknown }> = {};
  const totals = { claimed: 0, posted: 0, responded: 0, merged: 0, declined: 0, abandoned: 0 };

  for (const ev of events) {
    const g = (global[ev.item_id] ||= {
      posted_count: 0,
      merged_count: 0,
      declined_count: 0,
    });

    // Track latest event ordering per item per volunteer to handle release.
    if (ev.rating === 'claimed') {
      g.claimed_by = ev.volunteer_id;
      g.claimed_at = ev.created_at;
    } else if (ev.rating === 'released') {
      if (g.claimed_by === ev.volunteer_id) {
        g.claimed_by = undefined;
        g.claimed_at = undefined;
      }
    } else if (ev.rating === 'posted') {
      g.posted_count++;
      // A post implicitly resolves the claim — keep claimed_by so we know who.
    } else if (ev.rating === 'merged') {
      g.merged_count++;
    } else if (ev.rating === 'declined') {
      g.declined_count++;
    }

    const prevRank = WIKIPEDIA_EVENT_ORDER[g.latest_event ?? ''] ?? -1;
    const nextRank = WIKIPEDIA_EVENT_ORDER[ev.rating] ?? -1;
    if (nextRank >= prevRank) g.latest_event = ev.rating;

    // Per-volunteer view
    if (ev.volunteer_id === volunteerId) {
      const prev = mine[ev.item_id];
      const prevMyRank = prev ? (WIKIPEDIA_EVENT_ORDER[prev.latest_event] ?? -1) : -1;
      if (nextRank >= prevMyRank) {
        mine[ev.item_id] = { latest_event: ev.rating, created_at: ev.created_at, detail: ev.detail };
      }
    }

    if (ev.rating in totals) (totals as Record<string, number>)[ev.rating]++;
  }

  return NextResponse.json({ mine, global, totals });
}
