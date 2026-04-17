import { NextResponse } from 'next/server';

/**
 * GET /api/embassy/voice — Generate a signed URL for the ElevenLabs Conversational AI agent.
 * This keeps the agent private (not callable without a signed URL).
 */
export async function GET() {
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
