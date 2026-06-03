import { NextResponse } from 'next/server';
import { anonActionGate, SIGNIN_URL } from '@/lib/anon-gate';

export const dynamic = 'force-dynamic';

/**
 * GET /api/embassy/voice — Generate a signed URL for the ElevenLabs Conversational AI agent.
 * This keeps the agent private (not callable without a signed URL).
 *
 * Open to everyone, but anonymous visitors get 5 voice sessions/hour (each
 * "Begin" fetches a fresh signed URL); past that we return 401 with a sign-in
 * CTA. Signed-in users, SEO crawlers, and internal warmers are exempt.
 */
export async function GET(request: Request) {
  const gate = await anonActionGate(request, { name: 'voice-anon', limit: 5 });
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: 'You\'ve used your 5 free voice sessions this hour. Sign in (free) to keep talking with the Librarian.',
        code: 'SIGNIN_REQUIRED',
        sign_in: SIGNIN_URL,
      },
      { status: 401, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : {} },
    );
  }

  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId || !apiKey) {
    return NextResponse.json(
      { error: 'ElevenLabs agent not configured' },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[voice] ElevenLabs signed URL error:', res.status, text);
      return NextResponse.json(
        { error: 'Failed to get signed URL' },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json({ signedUrl: data.signed_url });
  } catch (err) {
    console.error('[voice] ElevenLabs signed URL error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
