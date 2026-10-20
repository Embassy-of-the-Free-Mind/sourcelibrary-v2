/**
 * The translation Lambda picks its Gemini model by the page's BOOK, not by a
 * constant — and the book it looks at has to carry a `language`.
 *
 * `src/workers/translation-processor-logic.ts` already called
 * `getModelForBook(bookDoc)`, but its projection fetched `title`, `author`,
 * `year` and `image_source.provider` and NOT `language`. The router therefore
 * saw `language: undefined` on every book, and unknown-language routes to full
 * flash by design (the safe side). Result: every job whose producer named no
 * model ran on flash, at $3.66/1K pages against $1.96/1K on the Hetzner worker
 * for the same model (issue #4749). Deleting `language: 1` from that projection
 * turns the first block below red again.
 *
 * Same shape as `ocr-lambda-routing.test.ts` (#4730): allowlist language →
 * lite, non-Latin / unknown / BPH → flash, an explicit `job.config.model` wins
 * because deliberate re-runs set one on purpose — and when it does win, the
 * worker says so in the log with the producer's `initiated_by`, so a leaked
 * constant is attributable instead of invisible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL } from '@/lib/types/ai-models';

type Doc = Record<string, unknown>;
const store: Record<string, Doc[]> = { jobs: [], pages: [], books: [] };

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async (filter: Doc, options?: { projection?: Record<string, number> }) => {
        const rows = store[name] || [];
        // Exact-match on scalar keys only; operator clauses (the previous-page
        // lookup's `{ $exists: true }`) never match, which is what page 1 expects.
        const row = rows.find((r) => Object.entries(filter).every(([k, v]) => r[k] === v)) ?? null;
        if (!row || !options?.projection) return row;
        // Honour the projection the way Mongo does — the bug under test IS a
        // projection that dropped a field, so a fake that ignores projections
        // would pass on main.
        const out: Doc = {};
        for (const key of Object.keys(options.projection)) {
          const top = key.split('.')[0];
          if (top in row) out[top] = row[top];
        }
        return out;
      },
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    }),
  })),
}));

const performTranslation = vi.fn();
vi.mock('@/lib/ai', () => ({ performTranslation: (...args: unknown[]) => performTranslation(...args) }));
vi.mock('@/lib/sqs-client', () => ({ sendWriteResult: vi.fn(async () => undefined) }));
vi.mock('@/lib/page-revisions', () => ({ createRevision: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase-page-writer', () => ({ syncPageUpdate: vi.fn() }));
vi.mock('@/lib/prompts', () => ({
  getTranslationPrompt: vi.fn(async () => ({
    text: 'TRANSLATE PROMPT',
    reference: { id: 'prompt-1', content_hash: 'abc', name: 'translation', version: 1 },
  })),
}));

import { processTranslationPage } from '@/workers/translation-processor-logic';

const OK = { text: 'Our gold is not the common gold.', usage: { inputTokens: 10, outputTokens: 5 } };

function seed(book: Doc, job: Doc = {}) {
  store.books = [{ id: 'b1', title: 'T', ...book }];
  store.pages = [{ id: 'p1', book_id: 'b1', page_number: 1, ocr: { data: 'Aurum nostrum non est aurum vulgi.' } }];
  store.jobs = [{ id: 'j1', type: 'translation', status: 'pending', config: { page_ids: ['p1'] }, created_at: new Date(), ...job }];
}

// performTranslation(text, sourceLang, targetLang, context, prompt, MODEL, bookContext)
const modelsUsed = () => performTranslation.mock.calls.map((c) => c[5] as string);

beforeEach(() => {
  performTranslation.mockReset();
  performTranslation.mockResolvedValue(OK);
});

describe('translation Lambda routes by book when the job names no model', () => {
  it.each([
    ['latin', DEFAULT_LITE_MODEL],
    ['English', DEFAULT_LITE_MODEL],
    ['german', DEFAULT_LITE_MODEL],
    ['polish', DEFAULT_LITE_MODEL],
    ['tibetan', DEFAULT_MODEL],
    ['malay', DEFAULT_MODEL],
    ['greek', DEFAULT_MODEL],
    ['', DEFAULT_MODEL],
  ])('language %j → %s', async (language, expected) => {
    seed({ language });
    await processTranslationPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([expected]);
  });

  it('null language → flash (unknown is the unsafe case)', async () => {
    seed({ language: null });
    await processTranslationPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });

  it('BPH provider → flash even for Latin', async () => {
    seed({ language: 'latin', image_source: { provider: 'bph' } });
    await processTranslationPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });
});

describe('an explicit job.config.model still wins, and is logged as an override', () => {
  it('flash on a Latin book runs on flash and names the producer', async () => {
    seed({ language: 'latin' }, {
      config: { page_ids: ['p1'], model: DEFAULT_MODEL },
      initiated_by: 'bulk-translate-script',
      initiated_reason: 'compare against lite',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await processTranslationPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
      expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('overrides routing'));
      expect(line).toBeDefined();
      expect(line).toContain(`${DEFAULT_MODEL} (routed: ${DEFAULT_LITE_MODEL})`);
      expect(line).toContain('initiated_by=bulk-translate-script');
      expect(line).toContain('reason=compare against lite');
    } finally {
      log.mockRestore();
    }
  });

  it('a job model that AGREES with routing is not an override', async () => {
    seed({ language: 'latin' }, { config: { page_ids: ['p1'], model: DEFAULT_LITE_MODEL } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await processTranslationPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
      expect(modelsUsed()).toEqual([DEFAULT_LITE_MODEL]);
      expect(log.mock.calls.some((c) => String(c[0]).includes('overrides routing'))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
});
