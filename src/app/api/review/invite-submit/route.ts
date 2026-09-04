import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyInviteToken } from '@/lib/review-invite-token';
import { isValidRating } from '@/lib/review-queue';

export const maxDuration = 5;

/**
 * POST /api/review/invite-submit
 *
 * Records one verdict from an emailed invitation. Same store, same queue and
 * same vocabulary as /api/review/submit — only the identity path differs, so
 * the rollup at /api/review/translation-check/summary needs no change and an
 * emailed answer counts exactly like one given while signed in.
 *
 * POST ONLY, AND THAT IS THE WHOLE SECURITY DESIGN OF THE EMAIL FLOW.
 * Corporate mail scanners and link-preview bots fetch every URL in a message
 * before a human sees it. If a GET recorded a verdict, a single send would
 * produce a wave of fabricated ratings — indistinguishable from real ones, in
 * the evidence store we intend to publish from. So the emailed link only ever
 * OPENS a page; a person has to press a button to record anything.
 *
 * The token carries the item and a derived, pseudonymous invitee id. It is not
 * a login: it grants exactly one capability, rating one specific page, and
 * cannot be walked to another.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = verifyInviteToken(String(body.token ?? ''));
  if (!payload) {
    return NextResponse.json({ error: 'invalid or expired link' }, { status: 403 });
  }

  const queue = 'translation-check';
  const rating = String(body.rating ?? '').trim() || null;
  const rawNote = body.note == null ? '' : String(body.note);
  const note = rawNote.trim() === '' ? null : rawNote.trim().slice(0, 4000);
  const passages = Array.isArray(body.passages) ? body.passages.slice(0, 20) : [];

  if (rating !== null && !isValidRating(queue, rating)) {
    return NextResponse.json({ error: 'invalid rating' }, { status: 400 });
  }
  if (rating === null && note === null) {
    return NextResponse.json({ error: 'a rating or a note is required' }, { status: 400 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  // One verdict per person per page: a reader who opens the link twice should
  // correct their answer, not double-count it. There is no unique constraint on
  // (queue,item_id,volunteer_id), so this is done as delete-then-insert rather
  // than an upsert the table cannot express.
  await supabaseAdmin
    .from('volunteer_ratings')
    .delete()
    .eq('queue', queue)
    .eq('item_id', payload.itemId)
    .eq('volunteer_id', payload.invitee);

  const { error } = await supabaseAdmin.from('volunteer_ratings').insert({
    queue,
    item_id: payload.itemId,
    rating,
    note,
    detail: { via: 'email-invite', passages },
    volunteer_id: payload.invitee,
    volunteer_label: 'invited reader',
    user_agent: request.headers.get('user-agent')?.slice(0, 240) ?? null,
  });

  if (error) {
    console.error('[review/invite-submit] insert failed:', error);
    return NextResponse.json({ error: 'could not record' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
