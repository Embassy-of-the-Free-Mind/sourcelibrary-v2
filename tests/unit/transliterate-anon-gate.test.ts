import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `POST /api/pages/[id]/transliterate` generates a paid Gemini call, and
 * TranslationEditor auto-fires it from a `useEffect` when the transliteration
 * panel opens — outside every `<AuthCheck>`, so a signed-out reader triggers
 * it. Editor-gating it (as ops#6 did for modernize/ask/detect-split) would
 * break signed-out reading of every non-Latin-script book, so anonymous volume
 * is METERED rather than walled.
 *
 * The invariant with teeth is the split: a CACHE HIT must stay free, because
 * that is the majority of real reader traffic and it costs nothing. Only the
 * generate path is gated. Getting that backwards — gating the whole route —
 * would wall readers on pages we have already paid for.
 *
 * This exercises the real route module with `anonActionGate` mocked at the
 * boundary, so it fails if the gate call is deleted, if it moves above the
 * cache return, or if a non-allowed result stops short-circuiting. Verified by
 * deleting the gate block and watching it go red, per the "a test that greps
 * source is not a guard" rule in CLAUDE.md.
 */

const gate = vi.fn(async () => ({ allowed: true }) as { allowed: boolean; retryAfter?: number });
const performTransliteration = vi.fn(async () => ({
  text: 'Aurum nostrum non est aurum vulgi.',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0 },
}));

vi.mock('@/lib/anon-gate', () => ({
  anonActionGate: (...args: unknown[]) => gate(...(args as [])),
  SIGNIN_URL: 'https://sourcelibrary.org/auth/signin',
}));

vi.mock('@/lib/ai', () => ({
  performTransliteration: (...args: unknown[]) => performTransliteration(...(args as [])),
}));

vi.mock('@/lib/gemini-logger', () => ({ logGeminiCall: vi.fn() }));

vi.mock('@/lib/tenant-context', () => ({
  resolveTenantId: vi.fn(async () => 'tenant-uuid'),
}));

/** OCR text and the hash the route computes from it, kept in sync below. */
const OCR = 'τὸ χρυσίον ἡμῶν οὐκ ἔστι τὸ χρυσίον τῶν πολλῶν';

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

/** A page whose stored transliteration matches its OCR — i.e. a cache hit. */
const CACHED_PAGE = {
  id: 'page-1',
  book_id: 'book-1',
  ocr: { data: OCR },
  transliteration: {
    data: 'to chrysion hemon ouk esti to chrysion ton pollon',
    source_ocr_hash: hashString(OCR),
    script: 'Greek',
  },
};

/** Same page with no stored transliteration — i.e. a cache miss. */
const UNCACHED_PAGE = { id: 'page-1', book_id: 'book-1', ocr: { data: OCR } };

let page: Record<string, unknown> = CACHED_PAGE;

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async () => (name === 'pages' ? page : { id: 'book-1', language: 'greek' }),
      updateOne: async () => ({ matchedCount: 1 }),
    }),
  })),
}));

/**
 * Both twins, always. Every route in this area exists twice, and #3511 found
 * two pairs that disagreed about who may call them — fixing one and shipping
 * is how the identical bug shipped twice in one week before.
 */
const ROUTES = [
  {
    name: '/api/pages/[id]/transliterate',
    load: () => import('@/app/api/pages/[id]/transliterate/route'),
    params: { id: 'page-1' },
  },
  {
    name: '/api/[tenant]/pages/[id]/transliterate',
    load: () => import('@/app/api/[tenant]/pages/[id]/transliterate/route'),
    params: { tenant: 'bph', id: 'page-1' },
  },
];

describe.each(ROUTES)(
  '$name meters anonymous generation without walling reads (ops#6)',
  (route) => {
    async function post(body: unknown = {}) {
      const { POST } = await route.load();
      const req = new Request('https://sourcelibrary.org/api/pages/page-1/transliterate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (POST as (r: unknown, c: unknown) => Promise<Response>)(req, {
        params: Promise.resolve(route.params),
      });
    }

    beforeEach(() => {
      gate.mockClear();
      performTransliteration.mockClear();
      gate.mockResolvedValue({ allowed: true });
      page = CACHED_PAGE;
    });

    it('serves a cache hit without consulting the gate at all', async () => {
      const res = await post();

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cached: true });
      // The point of the whole design: a free read never touches the limiter, so
      // browsing already-transliterated pages cannot exhaust the hourly budget.
      expect(gate).not.toHaveBeenCalled();
      expect(performTransliteration).not.toHaveBeenCalled();
    });

    it('serves a cache hit even when the gate would refuse', async () => {
      gate.mockResolvedValue({ allowed: false, retryAfter: 1800 });

      const res = await post();

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ cached: true });
    });

    it('consults the gate on a cache miss', async () => {
      page = UNCACHED_PAGE;

      const res = await post();

      expect(res.status).toBe(200);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(gate.mock.calls[0][1]).toMatchObject({ name: 'transliterate' });
      expect(performTransliteration).toHaveBeenCalledTimes(1);
    });

    it('consults the gate when regenerate skips a valid cache', async () => {
      const res = await post({ regenerate: true });

      expect(res.status).toBe(200);
      expect(gate).toHaveBeenCalledTimes(1);
    });

    it('refuses a walled caller with 401, a machine-readable code and Retry-After', async () => {
      page = UNCACHED_PAGE;
      gate.mockResolvedValue({ allowed: false, retryAfter: 1800 });

      const res = await post();

      expect(res.status).toBe(401);
      expect(res.headers.get('Retry-After')).toBe('1800');
      const body = await res.json();
      // The client keys on `code`, never on the copy — see the api-client
      // response interceptor, which carries code/sign_in through.
      expect(body.code).toBe('SIGNIN_REQUIRED');
      expect(body.sign_in).toBe('https://sourcelibrary.org/auth/signin');
      // Refusing must be free: no Gemini call happens behind a closed gate.
      expect(performTransliteration).not.toHaveBeenCalled();
    });

    it('omits Retry-After when the gate does not supply one', async () => {
      page = UNCACHED_PAGE;
      gate.mockResolvedValue({ allowed: false });

      const res = await post();

      expect(res.status).toBe(401);
      expect(res.headers.get('Retry-After')).toBeNull();
    });
  },
);
