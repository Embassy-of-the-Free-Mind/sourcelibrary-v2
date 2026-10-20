/**
 * `/api/books/[id]/batch-translate-async` (and its tenant twin) submit Gemini
 * Batch API translation jobs. Their default model was
 * `process.env.GEMINI_BATCH_MODEL || 'gemini-3-flash-preview'` and the router
 * was never consulted, so 1,776 pages of German, Polish, Latin and French —
 * all lite-eligible — ran on full flash in 30 days (issue #4749).
 *
 * This drives the REAL route handlers with the database, Gemini client and
 * auth wrapper faked, and asserts the model handed to `batches.create` and
 * recorded on the `batch_jobs` row. Restoring the flash default turns the
 * first case red. An explicit `model` in the body, or GEMINI_BATCH_MODEL in
 * the environment, is a deliberate override and still wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL } from '@/lib/types/ai-models';

vi.hoisted(() => {
  // Read once at module load by the route: with no key the submit loop never
  // runs and the handler answers 429 before any model is chosen.
  process.env.GEMINI_API_KEY = 'test-key';
});

type Doc = Record<string, unknown>;
const store: { book: Doc | null; pages: Doc[]; batchJobs: Doc[] } = { book: null, pages: [], batchJobs: [] };

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async () => (name === 'books' ? store.book : null),
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => store.pages }) }) }),
      insertOne: async (doc: Doc) => { if (name === 'batch_jobs') store.batchJobs.push(doc); return { insertedId: 'x' }; },
      updateOne: async () => ({ modifiedCount: 1 }),
    }),
  })),
}));

const batchesCreate = vi.fn(async (args: { model: string }) => ({ name: `batches/test-${args.model}`, state: 'JOB_STATE_PENDING' }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { batches = { create: (args: { model: string }) => batchesCreate(args) }; },
}));

// The gate is not under test here — ai-cost-route-auth.test.ts covers withAuth.
vi.mock('@/lib/auth-helpers', () => ({
  withAuth: (handler: (req: Request, session: unknown, ctx: unknown) => Promise<Response>) =>
    (req: Request, ctx: unknown) => handler(req, { user: { role: 'admin' } }, ctx),
}));
vi.mock('@/lib/gemini-logger', () => ({ logGeminiCall: vi.fn(async () => undefined) }));
vi.mock('@/lib/cron-auth', () => ({ getTriggerSource: () => 'test' }));
vi.mock('@/lib/page-revisions', () => ({ createRevision: vi.fn(async () => undefined) }));
vi.mock('@/lib/translate-write', () => ({
  findPendingBatchJob: vi.fn(async () => null),
  findHumanEditedPageIds: vi.fn(async () => new Set()),
}));
vi.mock('@/lib/tenant-context', () => ({ resolveTenantId: async () => 'bph-tenant' }));
vi.mock('@/lib/prompts', () => ({
  getTranslationPrompt: vi.fn(async () => ({
    text: 'TRANSLATE PROMPT',
    reference: { id: 'prompt-1', content_hash: 'abc', name: 'translation', version: 1 },
  })),
}));

const ROUTES = [
  { name: '/api/books/[id]/batch-translate-async', load: () => import('@/app/api/books/[id]/batch-translate-async/route'), params: { id: 'b1' } },
  { name: '/api/[tenant]/books/[id]/batch-translate-async', load: () => import('@/app/api/[tenant]/books/[id]/batch-translate-async/route'), params: { tenant: 'bph', id: 'b1' } },
];

function seed(book: Doc) {
  store.book = { id: 'b1', title: 'T', ...book };
  store.pages = [{ id: 'p1', book_id: 'b1', page_number: 1, ocr: { data: 'Aurum nostrum non est aurum vulgi.' } }];
  store.batchJobs = [];
}

async function submit(route: (typeof ROUTES)[number], body: Doc = {}) {
  const mod = await route.load();
  const handler = mod.POST as (req: Request, ctx: unknown) => Promise<Response>;
  const req = new Request('https://sourcelibrary.org/api/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve(route.params) });
  expect(res.status).toBe(200);
  return {
    submitted: batchesCreate.mock.calls.map((c) => c[0].model),
    recorded: store.batchJobs.map((j) => j.model),
  };
}

beforeEach(() => {
  batchesCreate.mockClear();
  vi.stubEnv('GEMINI_BATCH_MODEL', '');
});

for (const route of ROUTES) {
  describe(`${route.name} routes the batch model by book`, () => {
    it('a Latin book with no override → lite (the leak)', async () => {
      seed({ language: 'latin' });
      const { submitted, recorded } = await submit(route);
      expect(submitted).toEqual([DEFAULT_LITE_MODEL]);
      expect(recorded).toEqual([DEFAULT_LITE_MODEL]);
    });

    it.each(['german', 'polish', 'french'])('%s → lite', async (language) => {
      seed({ language });
      expect((await submit(route)).submitted).toEqual([DEFAULT_LITE_MODEL]);
    });

    it.each(['tibetan', 'greek', 'malay', null])('%j → flash', async (language) => {
      seed({ language });
      expect((await submit(route)).submitted).toEqual([DEFAULT_MODEL]);
    });

    it('BPH provider → flash even for Latin', async () => {
      seed({ language: 'latin', image_source: { provider: 'bph' } });
      expect((await submit(route)).submitted).toEqual([DEFAULT_MODEL]);
    });

    it('an explicit body.model is a deliberate override and wins', async () => {
      seed({ language: 'latin' });
      const { submitted, recorded } = await submit(route, { model: DEFAULT_MODEL });
      expect(submitted).toEqual([DEFAULT_MODEL]);
      expect(recorded).toEqual([DEFAULT_MODEL]);
    });

    it('GEMINI_BATCH_MODEL in the environment still overrides routing', async () => {
      vi.stubEnv('GEMINI_BATCH_MODEL', DEFAULT_MODEL);
      seed({ language: 'latin' });
      expect((await submit(route)).submitted).toEqual([DEFAULT_MODEL]);
    });
  });
}
