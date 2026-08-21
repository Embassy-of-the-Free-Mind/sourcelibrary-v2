import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidVolunteerId } from '@/lib/review-queue';

export const maxDuration = 5;

/**
 * GET /api/review/stats?volunteer_id=<uuid?>
 *
 * Returns lifetime totals and (if volunteer_id provided) per-volunteer
 * totals for the landing-page display.
 *
 * Counts filter `rating IS NOT NULL`: a volunteer may submit a note without a
 * rating, and those rows are feedback, not judgments. Including them would
 * inflate the rating count with things nobody rated.
 */
export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');

  const { count: total } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('id', { count: 'exact', head: true })
    .not('rating', 'is', null);

  const { count: notes } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('id', { count: 'exact', head: true })
    .not('note', 'is', null);

  let mine: number | null = null;
  if (volunteerId && isValidVolunteerId(volunteerId)) {
    const { count } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('volunteer_id', volunteerId)
      .not('rating', 'is', null);
    mine = count ?? 0;
  }

  return NextResponse.json({ total: total ?? 0, notes: notes ?? 0, mine });
}
