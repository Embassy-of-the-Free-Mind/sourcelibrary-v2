import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { PROPOSALS_COLLECTION, validateProposal } from '@/lib/learn-yucatec';

export const maxDuration = 5;

/**
 * POST /api/learn/yucatec/proposals (#6921) — { word_id, form, place?, note? }
 *
 * A signed-in learner says how people around them say a word today. Proposals
 * go to a speaker queue (`learn_yucatec_proposals`, status 'pending') and are
 * never shown on the page: a word shows a modern form only once a speaker has
 * confirmed it (`modern.confirmed_by` in the course file, see modernForm()).
 * The text is UNTRUSTED input: stored as text, never acted on automatically.
 * No job reads this collection today.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'sign in to suggest a form' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const err = validateProposal(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const db = await getDb();
  await db.collection(PROPOSALS_COLLECTION).insertOne({
    word_id: body.word_id,
    form: String(body.form).trim(),
    place: typeof body.place === 'string' && body.place.trim() ? body.place.trim() : null,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    learner: { kind: 'user', id: String(userId) },
    status: 'pending',
    created_at: new Date(),
  });
  return NextResponse.json({ ok: true });
}
