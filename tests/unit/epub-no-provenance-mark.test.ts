import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * EPUBs carry no zero-width provenance mark (#90, Kindle Publishing Guidelines §6.7);
 * every other export keeps it. The continuous EPUB and the TXT download share one
 * builder (buildFlowEpub), so the case that matters is that leaving the mark out of
 * one does not leave it out of the other.
 */
const ZW = /[​-‍⁠﻿]/;
const db = { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } as never;
const book = { id: 'b0000000000000000000test', title: 'T', author: 'A', language: 'Latin', pages_count: 2 } as never;
const pages = [1, 2].map((n) => ({
  id: `p${n}`, book_id: 'b0000000000000000000test', page_number: n,
  ocr: { data: 'Lorem ipsum dolor.' },
  translation: { data: `Page ${n}. The northern peoples keep their own customs, and their winters are long.` },
})) as never;

let mod: typeof import('@/lib/export-flow-epub');
let prov: typeof import('@/lib/provenance');
beforeAll(async () => {
  vi.stubEnv('PROVENANCE_SECRET_KEY', 'test-key-not-production');
  prov = await import('@/lib/provenance');
  mod = await import('@/lib/export-flow-epub');
});

describe('provenance mark in exports', () => {
  it('markForEpub returns the text unmarked; markForExport still marks', () => {
    const t = 'Page 1. The northern peoples keep their own customs, and their winters are long. '.repeat(3);
    expect(prov.markForEpub(t, 'b0000000000000000000test')).toBe(t);
    expect(prov.markForExport(t, 'b0000000000000000000test')).toMatch(ZW);
  });

  it('the continuous EPUB has no zero-width characters', async () => {
    const flow = await mod.buildFlowEpub(db, book, pages, { text: 'translation', baseUrl: 'https://sourcelibrary.org', includeImages: false, epub: true });
    flow.cleanup();
    const html = flow.chapters.map((c) => c.content).join('');
    expect(html).toContain('northern peoples');
    expect(html).not.toMatch(ZW);
  });

  it('the TXT download built from the same flow keeps the mark', async () => {
    const flow = await mod.buildFlowEpub(db, book, pages, { text: 'translation', baseUrl: 'https://sourcelibrary.org', includeImages: false });
    flow.cleanup();
    expect(flow.chapters.map((c) => c.content).join('')).toMatch(ZW);
  });
});
