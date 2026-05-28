import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidRating, QUEUE_KEYS } from '@/lib/review-queue';

export const maxDuration = 5;

const ALLOWED_QUEUES = new Set<string>(QUEUE_KEYS);

/**
 * POST /api/review/submit
 *
 * Body: { queue, item_id, rating, detail?, volunteer_id, volunteer_label? }
 *
 * Records one volunteer rating. Anonymous (no auth). volunteer_id is the
 * per-browser uuid the client generates.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const queue = String(body.queue ?? '').trim();
  const itemId = String(body.item_id ?? '').trim();
  const rating = String(body.rating ?? '').trim();
  const volunteerId = String(body.volunteer_id ?? '').trim();
  const volunteerLabel = body.volunteer_label ? String(body.volunteer_label).slice(0, 80) : null;
  const detail = body.detail ?? null;

  if (!ALLOWED_QUEUES.has(queue)) {
    return NextResponse.json({ error: 'unknown queue' }, { status: 400 });
  }
  if (!itemId || itemId.length > 200) {
    return NextResponse.json({ error: 'invalid item_id' }, { status: 400 });
  }
  if (!isValidRating(queue, rating)) {
    return NextResponse.json({ error: 'invalid rating for this queue' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(volunteerId)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  const ua = request.headers.get('user-agent')?.slice(0, 240) ?? null;

  const { error } = await supabaseAdmin.from('volunteer_ratings').insert({
    queue,
    item_id: itemId,
    rating,
    detail,
    volunteer_id: volunteerId,
    volunteer_label: volunteerLabel,
    user_agent: ua,
  });

  if (error) {
    console.error('[review/submit] insert failed:', error);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
