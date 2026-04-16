import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the route handler directly by importing GET
// and mocking env vars + global fetch

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function importRoute() {
  // Dynamic import to pick up fresh env stubs
  vi.resetModules();
  return import('@/app/api/embassy/voice/route');
}

describe('GET /api/embassy/voice', () => {
  it('returns 500 when ELEVENLABS_AGENT_ID is missing', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', '');
    vi.stubEnv('ELEVENLABS_API_KEY', 'sk_test');
    const { GET } = await importRoute();

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('not configured');
  });

  it('returns 500 when ELEVENLABS_API_KEY is missing', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_test');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    const { GET } = await importRoute();

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it('returns signed URL on success', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_test123');
    vi.stubEnv('ELEVENLABS_API_KEY', 'sk_test456');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?sig=abc' }),
    }));

    const { GET } = await importRoute();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signedUrl).toBe('wss://api.elevenlabs.io/v1/convai/conversation?sig=abc');

    // Verify the outgoing request used correct headers
    const fetchCall = (fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain('agent_id=agent_test123');
    expect(fetchCall[1].headers['xi-api-key']).toBe('sk_test456');
  });

  it('passes through ElevenLabs 401 (expired key)', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_test');
    vi.stubEnv('ELEVENLABS_API_KEY', 'sk_expired');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid api key'),
    }));

    const { GET } = await importRoute();
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('returns 500 on network error', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_test');
    vi.stubEnv('ELEVENLABS_API_KEY', 'sk_test');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await importRoute();
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Internal error');
  });
});
