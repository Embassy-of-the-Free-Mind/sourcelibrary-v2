import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { JUDGEMENTS_COLLECTION, validateAttempt } from '@/lib/learn-yucatec';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

/**
 * /api/learn/yucatec/attempts (#6921): the course's answers, in the /learn/maya
 * judgements collection under kind 'yucatec' (one answer) or 'yucatec-lesson'
 * (a finished lesson), so the glyph expert queue, which reads kind 'judgement',
 * never sees them.
 *
 * Signed-in only, and the learner is the SESSION's user id, never a client-sent
 * id (the review queues' 2026-08-05 rule, src/lib/volunteer-id.ts). Signed-out
 * learners keep progress on their device and send nothing. Nothing here is public.
 *
 * GET  → { attempts: [{ item_id, correct }], lessons: [{ lesson_id, day }] } for this learner, oldest first
 * POST { item_id, answer, correct, exercise?, lesson_id? } | { kind: 'lesson', lesson_id, day? }
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'sign in' }, { status: 401 });
  const db = await getDb();
  const rows = await db
    .collection(JUDGEMENTS_COLLECTION)
    .find(
      { kind: { $in: ['yucatec', 'yucatec-lesson'] }, 'learner.id': String(userId) },
      { projection: { _id: 0, kind: 1, item_id: 1, correct: 1, lesson_id: 1, day: 1 } },
    )
    .sort({ created_at: 1 })
    .limit(20000)
    .toArray();
  return NextResponse.json(
    {
      attempts: rows.filter((r) => r.kind === 'yucatec').map((r) => ({ item_id: r.item_id, correct: r.correct === true })),
      lessons: rows.filter((r) => r.kind === 'yucatec-lesson').map((r) => ({ lesson_id: r.lesson_id, day: r.day })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'sign in to keep your progress' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const err = validateAttempt(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const db = await getDb();
  const learner = { kind: 'user' as const, id: String(userId) };
  if (body.kind === 'lesson') {
    const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : new Date().toISOString().slice(0, 10);
    await db.collection(JUDGEMENTS_COLLECTION).insertOne({ kind: 'yucatec-lesson', course: 'yucatec', lesson_id: body.lesson_id, day, learner, created_at: new Date() });
    return NextResponse.json({ ok: true });
  }
  await db.collection(JUDGEMENTS_COLLECTION).insertOne({
    kind: 'yucatec',
    course: 'yucatec',
    item_id: body.item_id,
    learner,
    tier: 'learner',
    answer: body.answer,
    correct: body.correct,
    exercise: body.exercise ?? null,
    lesson_id: body.lesson_id ?? null,
    created_at: new Date(),
  });
  return NextResponse.json({ ok: true });
}
