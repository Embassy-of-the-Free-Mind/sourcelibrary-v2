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
    const t0 = Date.now();
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
      },
    );
    const latency = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text();
      console.error(`[voice] Signed URL failed: ${res.status} (${latency}ms) agent=${agentId?.slice(0, 12)}...`, text);
      return NextResponse.json(
        { error: 'Failed to get signed URL' },
        { status: res.status },
      );
    }

    const data = await res.json();
    if (latency > 2000) console.warn(`[voice] Signed URL slow: ${latency}ms — ElevenLabs may be degraded`);
    return NextResponse.json({ signedUrl: data.signed_url });
  } catch (err) {
    console.error('[voice] Signed URL network error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
