import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The anonymous gate on the transliterate routes, and — the part that actually
 * matters — WHERE it sits relative to the cache return.
 *
 * `transliterate` is the only AI page route with real anonymous reader traffic:
 * `TranslationEditor` auto-fires it from a `useEffect` when the transliteration
 * panel opens, and the toolbar toggle sits outside every `<AuthCheck>`. So it
 * gets a meter, not a wall — and the meter runs on the **cache-miss path only**.
 * A cache hit is a page we have already paid for; walling it would take
 * signed-out reading away from every non-Latin-script book for nothing.
 *
 * Both twins are covered (`/api/pages/...` and `/api/[tenant]/pages/...`) per
 * CLAUDE.md's "check the twins" rule — #3511 found two pairs that disagreed.
 *
 * This exercises the REAL route modules with `anonActionGate` mocked at the
 * boundary. Negative controls, each run and restored:
 *   - delete the gate from the unscoped route  → its 3 gate cases go red
 *   - delete it from the tenant route          → its 3 gate cases go red
 *   - move the gate ABOVE the cache return     → both cache-hit cases go red
 * The third is the plausible mistake and the expensive one.
 */

const { gateState, aiCalls } = vi.hoisted(() => ({
  gateState: { allowed: true, retryAfter: undefined as number | undefined },
  aiCalls: [] as string[],
}));

vi.mock('@/lib/anon-gate', () => ({
  SIGNIN_URL: 'https://sourcelibrary.org/auth/signin',
  anonActionGate: vi.fn(async () => ({
    allowed: gateState.allowed,
    retryAfter: gateState.retryAfter,
  })),
}));

// If this fires on a walled request, the gate did not stop the paid call.
vi.mock('@/lib/ai', () => ({
  performTransliteration: vi.fn(async (text: string) => {
    aiCalls.push(text);
    return { text: 'ho anthropos', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.0001 } };
  }),
}));

vi.mock('@/lib/gemini-logger', () => ({ logGeminiCall: vi.fn(async () => undefined) }));
vi.mock('@/lib/cron-auth', () => ({ getTriggerSource: vi.fn(() => 'manual') }));
vi.mock('@/lib/tenant-context', () => ({ resolveTenantId: vi.fn(async () => 'tenant-uuid-1') }));

/**
 * Same hash the routes use to decide whether a stored transliteration is still
 * valid for the current OCR. Duplicated here deliberately: the cache-hit cases
 * are only meaningful if the fixture's `source_ocr_hash` genuinely matches, and
 * asserting through the real comparison is the point.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

const OCR_TEXT = 'ὁ ἄνθρωπος';
const CACHED_TRANSLITERATION = 'ho anthropos (cached)';

/** Whether the page fixture carries a transliteration valid for OCR_TEXT. */
let pageHasValidCache = false;

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async () => {
        if (name === 'books') return { id: 'b1', language: 'Greek' };
        return {
          id: 'p1',
          book_id: 'b1',
          tenantId: 'tenant-uuid-1',
          ocr: { data: OCR_TEXT, language: 'Greek' },
          transliteration: pageHasValidCache
            ? { data: CACHED_TRANSLITERATION, source_ocr_hash: hashString(OCR_TEXT), script: 'Greek' }
            : undefined,
        };
      },
      updateOne: async () => ({ matchedCount: 1 }),
      insertOne: async () => ({ insertedId: 'x' }),
    }),
  })),
}));

type Twin = {
  name: string;
  load: () => Promise<{ POST: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> }>;
  params: Record<string, string>;
};

const TWINS: Twin[] = [
  {
    name: 'unscoped /api/pages/[id]/transliterate',
    load: () => import('@/app/api/pages/[id]/transliterate/route') as Promise<never>,
    params: { id: 'p1' },
  },
  {
    name: 'tenant /api/[tenant]/pages/[id]/transliterate',
    load: () => import('@/app/api/[tenant]/pages/[id]/transliterate/route') as Promise<never>,
    params: { tenant: 'bph', id: 'p1' },
  },
];

function post(body: unknown = {}): Request {
  return new Request('https://sourcelibrary.org/api/pages/p1/transliterate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.each(TWINS)('anon gate — $name', (twin) => {
  beforeEach(() => {
    gateState.allowed = true;
    gateState.retryAfter = undefined;
    pageHasValidCache = false;
    aiCalls.length = 0;
    vi.clearAllMocks();
  });

  it('walls an anonymous cache-miss with 429 and a machine-readable code', async () => {
    gateState.allowed = false;
    gateState.retryAfter = 1800;

    const { POST } = await twin.load();
    const res = await POST(post(), { params: Promise.resolve(twin.params) });
    const json = await res.json();

    expect(res.status).toBe(429);
    // The client keys on `code`, not on the copy — a regex over user-facing
    // prose stops matching the first time the wording changes.
    expect(json.code).toBe('SIGNIN_REQUIRED');
    expect(json.sign_in).toContain('/auth/signin');
    expect(json.error).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBe('1800');
    // The whole point of the gate: no paid call happened.
    expect(aiCalls).toHaveLength(0);
  });

  it('omits Retry-After when the gate reports no reset window', async () => {
    gateState.allowed = false;
    gateState.retryAfter = undefined;

    const { POST } = await twin.load();
    const res = await POST(post(), { params: Promise.resolve(twin.params) });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeNull();
    expect((await res.json()).code).toBe('SIGNIN_REQUIRED');
  });

  it('lets an allowed cache-miss through to generation', async () => {
    const { POST } = await twin.load();
    const res = await POST(post(), { params: Promise.resolve(twin.params) });

    expect(res.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
  });

  it('serves a valid cache hit ungated', async () => {
    pageHasValidCache = true;

    const { POST } = await twin.load();
    const res = await POST(post(), { params: Promise.resolve(twin.params) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cached).toBe(true);
    expect(json.transliteration).toBe(CACHED_TRANSLITERATION);

    const { anonActionGate } = await import('@/lib/anon-gate');
    // The gate must not even be consulted: this response costs nothing.
    expect(anonActionGate).not.toHaveBeenCalled();
  });

  it('still serves a cache hit when the gate is exhausted', async () => {
    // The regression this file exists for. If the gate moves above the cache
    // return, a signed-out reader past the cap loses pages we already paid to
    // transliterate — silently, and for an hour at a time.
    pageHasValidCache = true;
    gateState.allowed = false;
    gateState.retryAfter = 3600;

    const { POST } = await twin.load();
    const res = await POST(post(), { params: Promise.resolve(twin.params) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cached).toBe(true);
  });

  it('gates a forced regenerate even when a valid cache exists', async () => {
    // `regenerate: true` skips the cache, so it is a paid call and must meter.
    pageHasValidCache = true;
    gateState.allowed = false;

    const { POST } = await twin.load();
    const res = await POST(post({ regenerate: true }), { params: Promise.resolve(twin.params) });

    expect(res.status).toBe(429);
    expect(aiCalls).toHaveLength(0);
  });
});
