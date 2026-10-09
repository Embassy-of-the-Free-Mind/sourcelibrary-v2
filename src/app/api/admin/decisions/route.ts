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
 *
 * An API key answer is the exception: it is acted on here, at once, through
 * reviewKeyRequest (the same function /admin/api-keys uses). Default approves
 * and emails the key; Other denies with the text as the note. The answer row
 * goes `acting` → `done` or `failed`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isPlatformSuperadmin, withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { ANSWERS_COLLECTION, buildAnswer, type DecisionChoice } from '@/lib/decision-queue';
import { reviewKeyRequest } from '@/lib/dataset/api-key-review';
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
  const { insertedId } = await db.collection(ANSWERS_COLLECTION).insertOne(answer);

  if (answer.source === 'apikey' && answer.choice !== 'skip') {
    const action = answer.choice === 'default' ? 'approve' : 'deny';
    let status: 'done' | 'failed' = 'failed';
    let result = '';
    let next = '';
    try {
      const r = await reviewKeyRequest(db, answer.ref.keyRequest!, action, email,
        { notes: answer.choice === 'other' ? answer.text : null });
      if (!r.ok) {
        result = r.error;
      } else if (r.status === 'denied') {
        status = 'done';
        result = 'denied';
        next = 'Denied. The note is kept with the request.';
      } else {
        status = 'done';
        result = `approved, ${r.tier}, key ${r.prefix}${r.emailed ? ', emailed' : ', email NOT sent'}`;
        // The plaintext key is never stored; when the email did not go, this is the only copy.
        next = r.emailed
          ? `Approved. A ${r.tier} key was emailed to ${r.email}.`
          : `Approved, but the email did not send. Send ${r.email} this key yourself: ${r.key}`;
      }
    } catch (e) {
      result = (e as Error).message;
    }
    await db.collection(ANSWERS_COLLECTION).updateOne(
      { _id: insertedId }, { $set: { status, result, acted_at: new Date() } });
    if (status === 'failed') return NextResponse.json({ error: `Not done: ${result}` }, { status: 500 });
    return NextResponse.json({ ok: true, status, choice: answer.choice, next });
  }

  const next = answer.status === 'queued'
    ? (answer.choice === 'default'
      ? 'Queued. The Hetzner drainer runs safe-merge.sh within about 5 minutes.'
      : 'Queued. The Hetzner drainer comments and adds `blocked` within about 5 minutes.')
    : answer.choice === 'skip' ? 'Skipped for a day.' : 'Recorded.';
  return NextResponse.json({ ok: true, status: answer.status, choice: answer.choice, next });
}, { minRole: 'superadmin' });
