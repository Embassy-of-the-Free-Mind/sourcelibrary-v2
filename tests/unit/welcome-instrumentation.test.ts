import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { heroDisplayUrl } from '../../src/lib/welcome-hero';

// Two guards for the welcome page's instrumentation and its hero image.
//
// The analytics half matters because /api/analytics/event drops any prop key not
// on its allowlist SILENTLY — the client fires, the request 200s, and the field
// simply is not there when someone queries for it weeks later. Adding a prop
// without allowlisting it reproduces that bug inside its own fix, which is why
// these assert on the document the route actually writes rather than on the
// contents of the allowlist.
//
// The hero half matters because the welcome page renders full-bleed with
// `unoptimized`, so nothing resizes the source. Pointed at the raw archival URL
// it shipped a 26 MB scan to every reader.
const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: 'test' };
      },
    }),
  })),
}));

function post(body: unknown) {
  return new Request('https://sourcelibrary.org/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => { inserted.length = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('welcome analytics events', () => {
  it('accepts all three welcome events', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    for (const event of ['welcome_view', 'welcome_save', 'welcome_skip']) {
      const res = await POST(post({ event, props: { source: 'gate' } }));
      expect(res.status, `${event} was rejected`).toBe(200);
    }
    expect(inserted.map(d => d.event)).toEqual(['welcome_view', 'welcome_save', 'welcome_skip']);
  });

  it('persists which fields were filled on welcome_save', async () => {
    const { POST } = await import('@/app/api/analytics/event/route');
    await POST(post({
      event: 'welcome_save',
      props: { source: 'gate', hasName: true, hasAbout: true, hasHelp: false },
    }));

    expect(inserted).toHaveLength(1);
    // Booleans specifically: sanitizeProps only passes string/number/boolean, and
    // `false` must survive — it is the interesting half of the answer.
    expect(inserted[0].hasName).toBe(true);
    expect(inserted[0].hasAbout).toBe(true);
    expect(inserted[0].hasHelp).toBe(false);
  });

  it('keeps `source` so gate arrivals are separable from direct ones', async () => {
    // The ~3,850 backfilled users all arrive via the gate. Pooling them with
    // people who navigated to /welcome themselves makes the completion rate
    // describe no real population.
    const { POST } = await import('@/app/api/analytics/event/route');
    await POST(post({ event: 'welcome_view', props: { source: 'direct' } }));
    expect(inserted[0].source).toBe('direct');
  });

  it('never persists the reader\'s actual answers', async () => {
    // The prose belongs in users.profile. If someone later "improves" the event
    // by sending the text along, the allowlist should drop it — assert that it
    // does, rather than trusting the caller.
    const { POST } = await import('@/app/api/analytics/event/route');
    await POST(post({
      event: 'welcome_save',
      props: { source: 'gate', about_you: 'I am a lawyer and filmmaker.', name: 'Derek Lomas' },
    }));

    expect(inserted[0]).not.toHaveProperty('about_you');
    expect(inserted[0]).not.toHaveProperty('name');
  });
});

describe('welcome hero image', () => {
  it('routes the archival scan through the resizer instead of serving it raw', async () => {
    const raw = 'https://images.sourcelibrary.org/archived/69b525af95677df8153c6f62/66.jpg';
    const url = heroDisplayUrl(raw);

    // The raw URL is a 26 MB original; the page renders it with `unoptimized`,
    // so if this ever returns the bare URL again nothing downstream resizes it.
    expect(url).not.toBe(raw);
    expect(url.startsWith('/api/image?')).toBe(true);

    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('url')).toBe(raw);
    expect(Number(params.get('w'))).toBeLessThanOrEqual(1920);
    expect(Number(params.get('w'))).toBeGreaterThan(0);
    expect(Number(params.get('q'))).toBeLessThanOrEqual(90);
  });

  it('encodes the source URL so its query string cannot leak into ours', () => {
    const url = heroDisplayUrl('https://example.com/a.jpg?w=99999&evil=1');
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    // If the source were interpolated unencoded, `w` would resolve to 99999.
    expect(params.get('w')).toBe('1920');
    expect(params.get('evil')).toBeNull();
  });
});
