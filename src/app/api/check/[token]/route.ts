import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  READER_CHECK_JUDGEMENTS,
  judgementRow,
  loadReaderCheck,
  parseJudgement,
} from '@/lib/reader-check';

export const maxDuration = 10;

/**
 * POST /api/check/<token>  { index, choice, invented, note }
 *
 * Records one reader's answer on one page of a blind check (#7573).
 *
 * POST only, for the reason /api/review/invite-submit gives: mail scanners fetch
 * every link in a message, so opening the link must never record anything. A
 * person has to press the button.
 *
 * The token grants one capability: answering the twenty pages minted for it.
 * Answering a page again replaces the earlier answer (`_id` is
 * `<token_id>:<index>`), so a reader who goes back to change their mind is
 * counted once.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const db = await getDb();
  const doc = await loadReaderCheck(db, token);
  if (!doc) return NextResponse.json({ error: 'invalid or expired link' }, { status: 403 });

  const parsed = parseJudgement(doc, {
    index: body.index,
    choice: body.choice,
    invented: body.invented,
    note: body.note,
  });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const now = new Date();
  const row = judgementRow(doc, parsed.index, parsed, now);
  try {
    await db.collection(READER_CHECK_JUDGEMENTS).updateOne(
      { _id: `${doc._id}:${parsed.index}` as unknown as never },
      {
        $set: row,
        $setOnInsert: { created_at: now },
        $inc: { answer_count: 1 },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('[check] judgement write failed:', err);
    return NextResponse.json({ error: 'could not record' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
