import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/embassy/threads/[id]/podcast/ask — formerly "ask the hosts":
 * a reader's question answered in character by the two podcast voices
 * (a Gemini script plus a TTS render, paid per call).
 *
 * The podcast is retired and archived (#5007). Episodes stay listenable at
 * /podcast; the interactive mode is gone. 410 so a cached client stops asking.
 * The pre-retirement implementation is in git history before #5007.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'The podcast is retired; the hosts no longer take questions.' },
    { status: 410 },
  );
}
