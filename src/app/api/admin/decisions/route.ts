/**
 * Answer a card on /platform/admin/decisions (#6258).
 *
 * The card is rebuilt from its live source here, never taken from the client:
 * the answer records what the card said at the moment it was answered, and a
 * card that has changed since the page loaded (a push to the PR, an edited ops
 * row, someone else answering first) is refused with 409 so Derek reloads.
 *
 * This route only WRITES TO MONGO. A PR answer lands as `status: 'queued'` in
 * `decision_answers`, which scripts/maintenance/decision-answers-drain.mjs on
 * Hetzner reads and acts on (safe-merge.sh, or comment + `blocked`). Writing
 * here is therefore actuation, and the response says when it will act.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPlatformSuperadmin, withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { ANSWERS_COLLECTION, buildAnswer, type DecisionChoice } from '@/lib/decision-queue';
import { loadQueue } from '@/lib/decision-queue-sources';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await request.json().catch(() => null) as { cardId?: string; choice?: DecisionChoice; text?: string } | null;
  if (!body?.cardId || !body.choice) {
    return NextResponse.json({ error: 'cardId and choice are required' }, { status: 400 });
  }
  // withAuth lets the CRON_SECRET bearer through as an 'admin' session without
  // checking minRole, and can raise a role from a tenant membership. An answer
  // here can merge to main, so only a PLATFORM superadmin answers: the JWT role,
  // or the same grant lookup withAuth uses.
  const email = session.user?.email;
  const jwtRole = (session.user as { role?: string } | undefined)?.role;
  if (!email || (jwtRole !== 'superadmin' && !(await isPlatformSuperadmin(email)))) {
    return NextResponse.json({ error: 'Forbidden - platform superadmin only' }, { status: 403 });
  }

  const db = await getDb();
  const queue = await loadQueue(db);
  const card = queue.cards.find((c) => c.id === body.cardId);
  if (!card) {
    return NextResponse.json(
      { error: 'This card changed or was already answered. Reload the page.' },
      { status: 409 },
    );
  }

  let answer;
  try {
    answer = buildAnswer({ card, choice: body.choice, text: body.text }, email, new Date());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  await db.collection(ANSWERS_COLLECTION).insertOne(answer);

  const next = answer.status === 'queued'
    ? (answer.choice === 'default'
      ? 'Queued. The Hetzner drainer runs safe-merge.sh within about 5 minutes.'
      : 'Queued. The Hetzner drainer comments and adds `blocked` within about 5 minutes.')
    : answer.choice === 'skip' ? 'Skipped for a day.' : 'Recorded.';
  return NextResponse.json({ ok: true, status: answer.status, choice: answer.choice, next });
}, { minRole: 'superadmin' });
