/**
 * The OCR Lambda picks its Gemini model by the page's BOOK, not by a constant.
 *
 * `tests/unit/translate-core-parity.test.ts` pins the three routing functions
 * against each other. This test pins the one call site that used to ignore all
 * three: `src/workers/ocr-processor-logic.ts` read `job.config.model ||
 * DEFAULT_MODEL`, so every job whose producer forgot to name a model ran on
 * full flash. That is how 125,585 pages of mostly-Latin import previews went
 * through the realtime lane at $3.42/1K instead of $0.85/1K (issue #4729;
 * the producer was removed in #4432, this pins the sink).
 *
 * Probes are the same shape as the parity test: allowlist language → lite,
 * non-Latin / unknown / BPH → flash, and an explicit `job.config.model` wins
 * because deliberate re-OCR jobs set one on purpose.
 *
 * Also pinned: the RECITATION fallback ladder. It used to be a fixed
 * `flash → lite` chain, so a Tibetan page that hit RECITATION on flash was
 * retried on lite — the documented hallucination case (#4523). The fallback
 * may only step onto a model the book is allowed to use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_LITE_MODEL } from '@/lib/types/ai-models';

type Doc = Record<string, unknown>;
const store: Record<string, Doc[]> = { jobs: [], pages: [], books: [] };

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async (filter: Doc) => {
        const rows = store[name] || [];
        return rows.find((r) => Object.entries(filter).every(([k, v]) => r[k] === v)) ?? null;
      },
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
    }),
  })),
}));

const performOCRWithBuffer = vi.fn();
vi.mock('@/lib/ai', () => ({ performOCRWithBuffer: (...args: unknown[]) => performOCRWithBuffer(...args) }));
vi.mock('@/lib/sqs-client', () => ({ sendWriteResult: vi.fn(async () => undefined) }));
vi.mock('@/lib/page-revisions', () => ({ createRevision: vi.fn(async () => undefined) }));
vi.mock('@/lib/prompts', () => ({
  getOcrPrompt: vi.fn(async () => ({
    text: 'OCR PROMPT',
    reference: { id: 'prompt-1', content_hash: 'abc', name: 'ocr', version: 1 },
  })),
}));
vi.mock('@/lib/api-client/images', () => ({
  images: { fetchBufferWithMimeType: vi.fn(async () => ({ buffer: Buffer.from('jpg'), mimeType: 'image/jpeg' })) },
}));

import { processOcrPage } from '@/workers/ocr-processor-logic';

const OK = { text: 'lorem ipsum', usage: { inputTokens: 10, outputTokens: 5 } };

function seed(book: Doc, jobConfig: Doc = {}) {
  store.books = [{ id: 'b1', title: 'T', ...book }];
  store.pages = [{ id: 'p1', book_id: 'b1', page_number: 1, archived_photo: 'https://r2.example/b1/1.jpg' }];
  store.jobs = [{ id: 'j1', type: 'ocr', status: 'pending', config: { page_ids: ['p1'], ...jobConfig }, created_at: new Date() }];
}

const modelsUsed = () => performOCRWithBuffer.mock.calls.map((c) => c[4] as string);

beforeEach(() => {
  performOCRWithBuffer.mockReset();
  performOCRWithBuffer.mockResolvedValue(OK);
});

describe('OCR Lambda routes by book when the job names no model', () => {
  it.each([
    ['latin', DEFAULT_LITE_MODEL],
    ['English', DEFAULT_LITE_MODEL],
    ['german', DEFAULT_LITE_MODEL],
    ['tibetan', DEFAULT_MODEL],
    ['malay', DEFAULT_MODEL],
    ['sanskrit', DEFAULT_MODEL],
    ['', DEFAULT_MODEL],
  ])('language %j → %s', async (language, expected) => {
    seed({ language });
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([expected]);
  });

  it('null language → flash (unknown is the unsafe case)', async () => {
    seed({ language: null });
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });

  it('BPH provider → flash even for Latin', async () => {
    seed({ language: 'latin', image_source: { provider: 'bph' } });
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });

  it('a missing book document → flash, never a throw', async () => {
    seed({ language: 'latin' });
    store.books = [];
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });

  it('an explicit job.config.model wins over the book (deliberate re-OCR)', async () => {
    seed({ language: 'latin' }, { model: DEFAULT_MODEL });
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });
});

describe('RECITATION fallback respects the allowlist', () => {
  const recitation = () =>
    Promise.reject(new Error('Gemini API error: Candidate was blocked due to RECITATION'));

  it('Latin on lite → retries on flash', async () => {
    seed({ language: 'latin' });
    performOCRWithBuffer.mockImplementationOnce(recitation);
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_LITE_MODEL, DEFAULT_MODEL]);
  });

  it('Tibetan on flash → does NOT step down to lite', async () => {
    seed({ language: 'tibetan' });
    performOCRWithBuffer.mockImplementationOnce(recitation);
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL]);
  });

  it('Latin forced onto flash by the job → may step down to lite', async () => {
    seed({ language: 'latin' }, { model: DEFAULT_MODEL });
    performOCRWithBuffer.mockImplementationOnce(recitation);
    await processOcrPage({ bookId: 'b1', pageId: 'p1', jobId: 'j1' });
    expect(modelsUsed()).toEqual([DEFAULT_MODEL, DEFAULT_LITE_MODEL]);
  });
});
