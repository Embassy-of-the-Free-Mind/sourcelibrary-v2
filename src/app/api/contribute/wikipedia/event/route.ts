import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidRating } from '@/lib/review-queue';

export const maxDuration = 5;

/**
 * POST /api/contribute/wikipedia/event
 *
 * Body: { item_id, event, volunteer_id, detail? }
 *
 * Records one Wikipedia-playbook state-transition event. The event log is
 * shared with the rating queues (volunteer_ratings table, queue='wikipedia').
 *
 * Valid events: claimed | released | posted | responded | merged | declined | abandoned
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const itemId = String(body.item_id ?? '').trim();
  const event = String(body.event ?? '').trim();
  const volunteerId = String(body.volunteer_id ?? '').trim();
  const detail = body.detail ?? null;

  if (!itemId || itemId.length > 200) {
    return NextResponse.json({ error: 'invalid item_id' }, { status: 400 });
  }
  if (!isValidRating('wikipedia', event)) {
    return NextResponse.json({ error: 'invalid event' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(volunteerId)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  const ua = request.headers.get('user-agent')?.slice(0, 240) ?? null;

  const { error } = await supabaseAdmin.from('volunteer_ratings').insert({
    queue: 'wikipedia',
    item_id: itemId,
    rating: event,
    detail,
    volunteer_id: volunteerId,
    user_agent: ua,
  });

  if (error) {
    console.error('[wikipedia/event] insert failed:', error);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
