import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ITEMS_COLLECTION, JUDGEMENTS_COLLECTION, validateJudgement } from '@/lib/learn-maya';
import { COURSE_ITEMS } from '@/app/learn/maya/course';

export const maxDuration = 5;

/**
 * POST /api/learn/maya/judgements (#6921)
 *
 * Body (item):  { item_id, answer, correct, verdict: agree|disagree|unsure|null, correction?, items_seen? }
 *   item_id is a learn_maya_items id (v1 bank) or a course item id (src/app/learn/maya/course.ts,
 *   v2), stored with rung `course:<lesson>`; course answers carry verdict null.
 * Body (check): { kind: 'check', score, total, answers: [{item_id, answer, correct}] }
 *
 * Signed-in only, and the learner is the SESSION's user id, never a client-sent
 * id: the same rule the review queues adopted on 2026-08-05 (src/lib/volunteer-id.ts),
 * because agreement measured over anonymous browser ids splits one reader into
 * several. Signed-out learners keep their progress locally and send nothing.
 * Nothing here is shown publicly; only the inner-circle expert queue reads it.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'sign in to record judgements' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const err = validateJudgement(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const db = await getDb();
  const learner = { kind: 'user' as const, id: String(userId) };
  const itemsSeen = typeof body.items_seen === 'number' ? Math.max(0, Math.floor(body.items_seen)) : null;

  if (body.kind === 'check') {
    const answers = (body.answers as Array<Record<string, unknown>>).map((a) => ({
      item_id: String(a.item_id ?? '').slice(0, 60),
      answer: String(a.answer ?? '').slice(0, 200),
      correct: a.correct === true,
    }));
    await db.collection(JUDGEMENTS_COLLECTION).insertOne({
      kind: 'check', learner, tier: 'learner', score: body.score, total: body.total, answers, items_seen: itemsSeen, created_at: new Date(),
    });
    return NextResponse.json({ ok: true });
  }

  const course = COURSE_ITEMS.get(body.item_id as string);
  const item = course
    ? { rung: `course:${course.lesson}`, status: 'live' }
    : await db.collection(ITEMS_COLLECTION).findOne({ _id: body.item_id as never }, { projection: { rung: 1, status: 1 } });
  if (!item || item.status === 'retired') return NextResponse.json({ error: 'unknown item' }, { status: 404 });

  const correction = typeof body.correction === 'string' && body.correction.trim() ? body.correction.trim() : null;
  await db.collection(JUDGEMENTS_COLLECTION).insertOne({
    kind: 'judgement',
    item_id: body.item_id,
    rung: item.rung,
    learner,
    tier: 'learner',
    answer: body.answer,
    correct: body.correct,
    verdict: body.verdict,
    correction,
    items_seen: itemsSeen,
    created_at: new Date(),
  });
  return NextResponse.json({ ok: true });
}
