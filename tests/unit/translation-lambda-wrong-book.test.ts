/**
 * The translation Lambda translates a page only under its OWN book (#7085).
 *
 * A message carries the job's book id, and the processor reads that book for the previous page
 * (`book_id: bookId, page_number - 1`), the source language and the title context. A 2026-03
 * job filed under the Argonauticon (6974b64619126e775cf6d7e1) carried Llull Ars brevis pages
 * (…e3): each Llull page N was translated with Argonauticon page N-1 as its context, and p.23 came
 * back with Argonautica lines in its English. Pinned here: a page from another book is refused
 * before any model call, and a page of the job's book still gets its own previous page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Doc = Record<string, unknown>;
const store: Record<string, Doc[]> = { jobs: [], pages: [], books: [] };
const matches = (r: Doc, filter: Doc) => Object.entries(filter).every(([k, v]) => {
  if (k.includes('.')) return true; // `translation.data: {$exists}` — every seeded prev page has one
  return r[k] === v;
});

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      findOne: async (filter: Doc) => (store[name] || []).find((r) => matches(r, filter)) ?? null,
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
      insertOne: vi.fn(async () => ({ insertedId: 'x' })),
    }),
  })),
}));

const performTranslation = vi.fn();
vi.mock('@/lib/ai', () => ({ performTranslation: (...args: unknown[]) => performTranslation(...args) }));
const sendWriteResult = vi.fn(async (_r: unknown) => undefined);
vi.mock('@/lib/sqs-client', () => ({ sendWriteResult: (r: unknown) => sendWriteResult(r) }));
vi.mock('@/lib/page-revisions', () => ({ createRevision: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase-page-writer', () => ({ syncPageUpdate: vi.fn() }));
vi.mock('@/lib/prompts', () => ({
  getTranslationPrompt: vi.fn(async () => ({
    text: 'TRANSLATION PROMPT',
    reference: { id: 'prompt-1', content_hash: 'abc', name: 'translation', version: 1 },
  })),
}));

import { processTranslationPage } from '@/workers/translation-processor-logic';

const JOB_BOOK = 'argonauticon';
const OTHER_BOOK = 'llull';

function seed(pageBook: string) {
  store.books = [
    { id: JOB_BOOK, title: 'Argonauticon libri IIII', language: 'Greek' },
    { id: OTHER_BOOK, title: 'Ars brevis', language: 'Latin' },
  ];
  store.pages = [
    { id: 'prev-argo', book_id: JOB_BOOK, page_number: 22, translation: { data: 'ARGONAUTICA CATALOGUE' } },
    { id: 'prev-llull', book_id: OTHER_BOOK, page_number: 22, translation: { data: 'LLULL PAGE 22' } },
    { id: 'p23', book_id: pageBook, page_number: 23, ocr: { data: '<page-type>text</page-type>\nQuarta figura habet tres circulos.' } },
  ];
  store.jobs = [{ id: 'j1', type: 'translation', status: 'pending', book_id: JOB_BOOK, config: { page_ids: ['p23'], language: 'Greek' } }];
}

beforeEach(() => {
  performTranslation.mockReset();
  // Stop the run at the model call: what it was handed is what this suite pins.
  performTranslation.mockRejectedValue(new Error('stop after the call'));
  sendWriteResult.mockClear();
});

describe('translation Lambda: a job translates only its own book\'s pages (#7085)', () => {
  it('refuses a page from another book before any model call', async () => {
    seed(OTHER_BOOK);
    await processTranslationPage({ bookId: JOB_BOOK, pageId: 'p23', jobId: 'j1' } as never);
    expect(performTranslation).not.toHaveBeenCalled();
    const results = sendWriteResult.mock.calls.map((c) => c[0] as Doc);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ failed: true, error: { category: 'wrong_book' } });
  });

  it('still translates a page of the job\'s book, with that book\'s previous page as context', async () => {
    seed(JOB_BOOK);
    await processTranslationPage({ bookId: JOB_BOOK, pageId: 'p23', jobId: 'j1' } as never);
    expect(performTranslation).toHaveBeenCalledTimes(1);
    expect(performTranslation.mock.calls[0][3]).toBe('ARGONAUTICA CATALOGUE');
  });
});
