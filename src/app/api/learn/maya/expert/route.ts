import { NextRequest, NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { ITEMS_COLLECTION, JUDGEMENTS_COLLECTION, needsExpert, type QueueStats } from '@/lib/learn-maya';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * GET  /api/learn/maya/expert — items learners dispute (#6921), with counts and their corrections.
 * POST /api/learn/maya/expert — { item_id, verdict: 'ai-right'|'ai-wrong', correction?, note? }
 *
 * Inner circle only (a `memberships` grant, so an outside epigrapher can be let
 * in without editor powers). Learners appear as counts, never by name or id.
 */
export const GET = withInnerCircleAuth(async () => {
  const db = await getDb();
  const rows = await db
    .collection(JUDGEMENTS_COLLECTION)
    .aggregate([
      { $match: { kind: 'judgement' } },
      { $sort: { created_at: 1 } },
      {
        $group: {
          _id: '$item_id',
          agree: { $sum: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $eq: ['$verdict', 'agree'] }] }, 1, 0] } },
          disagree: { $sum: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $eq: ['$verdict', 'disagree'] }] }, 1, 0] } },
          unsure: { $sum: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $eq: ['$verdict', 'unsure'] }] }, 1, 0] } },
          right: { $sum: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $eq: ['$correct', true] }] }, 1, 0] } },
          wrong: { $sum: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $eq: ['$correct', false] }] }, 1, 0] } },
          lastDispute: { $max: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $ne: ['$verdict', 'agree'] }] }, '$created_at', null] } },
          expertAt: { $max: { $cond: [{ $eq: ['$tier', 'expert'] }, '$created_at', null] } },
          corrections: { $push: { $cond: [{ $and: [{ $eq: ['$tier', 'learner'] }, { $ne: ['$correction', null] }] }, '$correction', '$$REMOVE'] } },
          answers: { $push: { $cond: [{ $eq: ['$tier', 'learner'] }, '$answer', '$$REMOVE'] } },
        },
      },
    ])
    .toArray();

  const queued = rows.filter((r) => needsExpert(r as unknown as QueueStats, r.lastDispute ?? null, r.expertAt ?? null));
  const items = queued.length
    ? await db.collection(ITEMS_COLLECTION).find({ _id: { $in: queued.map((r) => r._id) } }, { projection: { provenance: 0 } }).toArray()
    : [];
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const queue = queued
    .filter((r) => byId.has(String(r._id)))
    .sort((a, b) => b.disagree - a.disagree || +new Date(b.lastDispute ?? 0) - +new Date(a.lastDispute ?? 0))
    .map((r) => ({
      item: byId.get(String(r._id)),
      stats: { agree: r.agree, disagree: r.disagree, unsure: r.unsure, right: r.right, wrong: r.wrong },
      corrections: (r.corrections as string[]).slice(-5),
      answers: (r.answers as string[]).slice(-10),
    }));
  const judgementsTotal = rows.reduce((n, r) => n + r.agree + r.disagree + r.unsure, 0);
  return NextResponse.json({ queue, judgementsTotal, itemsJudged: rows.length });
});

export const POST = withInnerCircleAuth(async (request: NextRequest, session: Session) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const itemId = typeof body.item_id === 'string' ? body.item_id : '';
  const verdict = body.verdict;
  if (!/^[A-Za-z0-9-]{3,60}$/.test(itemId) || (verdict !== 'ai-right' && verdict !== 'ai-wrong')) {
    return NextResponse.json({ error: 'item_id and verdict (ai-right|ai-wrong) required' }, { status: 400 });
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : null);
  const correction = text(body.correction);
  const note = text(body.note);

  const db = await getDb();
  const item = await db.collection(ITEMS_COLLECTION).findOne({ _id: itemId as never }, { projection: { gold: 1 } });
  if (!item) return NextResponse.json({ error: 'unknown item' }, { status: 404 });

  const by = String(session.user?.id ?? '');
  const priorBasis = String(item.gold?.basis ?? '').replace(/\+expert$/, '');
  const at = new Date();
  await db.collection(JUDGEMENTS_COLLECTION).insertOne({
    kind: 'judgement', item_id: itemId, learner: { kind: 'user', id: by }, tier: 'expert',
    verdict: verdict === 'ai-right' ? 'agree' : 'disagree', correction, note, created_at: at,
  });
  // An expert's "right" makes the item gold; "wrong" takes gold away until the key is fixed.
  await db.collection(ITEMS_COLLECTION).updateOne(
    { _id: itemId as never },
    {
      $set: {
        review: { verdict, correction, note, by, at },
        gold: verdict === 'ai-right'
          ? { is_gold: true, basis: item.gold?.is_gold && priorBasis && priorBasis !== 'expert' ? `${priorBasis}+expert` : 'expert', checked_by_eye: true }
          : { is_gold: false, basis: 'expert-disputed', checked_by_eye: true },
        updated_at: at,
      },
    },
  );
  return NextResponse.json({ ok: true });
});
