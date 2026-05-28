import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 5;

/**
 * GET /api/review/stats?volunteer_id=<uuid?>
 *
 * Returns lifetime totals and (if volunteer_id provided) per-volunteer
 * totals for the landing-page display.
 */
export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');

  const { count: total } = await supabaseAdmin
    .from('volunteer_ratings')
    .select('id', { count: 'exact', head: true });

  let mine: number | null = null;
  if (volunteerId && /^[0-9a-f-]{36}$/i.test(volunteerId)) {
    const { count } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('id', { count: 'exact', head: true })
      .eq('volunteer_id', volunteerId);
    mine = count ?? 0;
  }

  return NextResponse.json({ total: total ?? 0, mine });
}
