import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #6122. getTranslationPrompt() swapped in non-default, never-evaluated language
 * prompts ("Latin Translation (Neo-Latin)" v2, "German Translation (Early
 * Modern)" v3, Arabic, Hebrew) for those languages, so the API route translated
 * ~13.9K pp/30d on a prompt no fidelity eval measures while every pipeline lane
 * used the is_default one. The fake collection below holds the live shape: the
 * language rows exist and are found by name — the test fails if anything asks
 * for them without being told to.
 */
const ROWS = [
  { _id: 'std13', type: 'translation', name: 'Standard Translation', version: 13, is_default: true, content: 'STANDARD {source_language} -> {target_language}' },
  { _id: 'lat2', type: 'translation', name: 'Latin Translation (Neo-Latin)', version: 2, is_default: false, content: 'LATIN FORK' },
  { _id: 'ger3', type: 'translation', name: 'German Translation (Early Modern)', version: 3, is_default: false, content: 'GERMAN FORK' },
  { _id: 'ara1', type: 'translation', name: 'Arabic Translation', version: 1, is_default: false, content: 'ARABIC FORK' },
  { _id: 'heb1', type: 'translation', name: 'Hebrew Translation', version: 1, is_default: false, content: 'HEBREW FORK' },
];

const queries: Array<Record<string, unknown>> = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: () => ({
      findOne: async (q: Record<string, unknown>) => {
        queries.push(q);
        return ROWS.find((r) => Object.entries(q).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null;
      },
    }),
  }),
}));

import { getTranslationPrompt } from '@/lib/prompts';

describe('getTranslationPrompt — no per-language prompt fork (#6122)', () => {
  beforeEach(() => { queries.length = 0; });

  it.each(['Latin', 'German', 'Arabic', 'Hebrew', 'latin'])('%s gets the is_default prompt', async (lang) => {
    const r = await getTranslationPrompt(lang, 'English');
    expect(r.reference.id).toBe('std13');
    expect(r.reference.version).toBe(13);
    expect(r.text).toBe(`STANDARD ${lang} -> English`);
    expect(queries.some((q) => 'name' in q)).toBe(false);
  });

  it('still honours a prompt the caller names', async () => {
    const r = await getTranslationPrompt('Latin', 'English', { name: 'Latin Translation (Neo-Latin)' });
    expect(r.reference.id).toBe('lat2');
  });
});
