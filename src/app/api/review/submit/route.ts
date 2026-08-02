import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isValidRating, QUEUE_KEYS } from '@/lib/review-queue';

export const maxDuration = 5;

const ALLOWED_QUEUES = new Set<string>(QUEUE_KEYS);
const MAX_NOTE_LENGTH = 4000;

/**
 * POST /api/review/submit
 *
 * Body: { queue, item_id, rating?, note?, detail?, volunteer_id, volunteer_label? }
 *
 * Records one volunteer judgment. Anonymous (no auth). volunteer_id is the
 * per-browser uuid the client generates.
 *
 * `rating` and `note` are independently optional, but a submission must carry
 * at least one. A note WITHOUT a rating is deliberate and valid: a volunteer
 * who can't honestly pick any button still needs somewhere to say why, and
 * pushing them into a button to satisfy a NOT NULL would corrupt the very
 * distribution the buttons exist to measure.
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
  const volunteerId = String(body.volunteer_id ?? '').trim();
  const volunteerLabel = body.volunteer_label ? String(body.volunteer_label).slice(0, 80) : null;
  const detail = body.detail ?? null;

  const rawRating = body.rating == null ? '' : String(body.rating).trim();
  const rating = rawRating === '' ? null : rawRating;

  const rawNote = body.note == null ? '' : String(body.note);
  const note = rawNote.trim() === '' ? null : rawNote.trim().slice(0, MAX_NOTE_LENGTH);

  if (!ALLOWED_QUEUES.has(queue)) {
    return NextResponse.json({ error: 'unknown queue' }, { status: 400 });
  }
  if (!itemId || itemId.length > 200) {
    return NextResponse.json({ error: 'invalid item_id' }, { status: 400 });
  }
  if (rating !== null && !isValidRating(queue, rating)) {
    return NextResponse.json({ error: 'invalid rating for this queue' }, { status: 400 });
  }
  if (rating === null && note === null) {
    return NextResponse.json({ error: 'a rating or a note is required' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(volunteerId)) {
    return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'supabase admin not configured' }, { status: 500 });
  }

  const ua = request.headers.get('user-agent')?.slice(0, 240) ?? null;

  const row = {
    queue,
    item_id: itemId,
    rating,
    note,
    detail,
    volunteer_id: volunteerId,
    volunteer_label: volunteerLabel,
    user_agent: ua,
  };

  const { error } = await supabaseAdmin.from('volunteer_ratings').insert(row);
  if (!error) return NextResponse.json({ ok: true });

  /* COMPAT SHIM — remove once 20260802000000_volunteer_ratings_note.sql is
     applied to production.
     Merging a PR here does not deploy, and this DDL is applied by hand, so the
     code and the schema can go live in either order. Without this branch, the
     window between them fails EVERY submission — turning a feature addition
     into an outage on the exact surface we are trying to revive.
     The fallback keeps the note in `detail` (jsonb, already present) so no
     volunteer's words are lost while the column is missing. A note-only
     submission genuinely cannot be stored, because `rating` is still NOT NULL —
     we say so rather than inventing a rating, which would corrupt the
     distribution the ratings exist to measure. */
  const missingColumn = error.code === 'PGRST204' || error.code === '42703';
  if (missingColumn && note !== null) {
    if (rating === null) {
      console.error('[review/submit] note-only submission rejected — run the volunteer_ratings note migration');
      return NextResponse.json(
        { error: 'notes are not enabled yet — please include a rating' },
        { status: 503 },
      );
    }
    console.warn('[review/submit] `note` column missing — storing note in detail. Run the migration.');
    const { error: retryError } = await supabaseAdmin.from('volunteer_ratings').insert({
      ...row,
      note: undefined,
      detail: { ...(typeof detail === 'object' && detail !== null ? detail : {}), note },
    });
    if (!retryError) return NextResponse.json({ ok: true, noteStoredInDetail: true });
    console.error('[review/submit] retry insert failed:', retryError);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  console.error('[review/submit] insert failed:', error);
  return NextResponse.json({ error: 'insert failed' }, { status: 500 });
}
