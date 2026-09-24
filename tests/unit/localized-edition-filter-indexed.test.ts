import { describe, it, expect } from 'vitest';
import { localizedEditionFilter, localizedEditionFilterIndexed, isNativeEdition, type LanguageSpellingsSource } from '@/lib/localized';

/**
 * `localizedEditionFilterIndexed` resolves the /i language regex into an `$in`
 * of the live spellings so the corpus-wide Spanish $group can ride an index
 * (#5073, #5074). The rule it must keep: the SAME set as the sync filter and
 * `isNativeEdition` — the regex is applied to every stored value, so what it
 * selects in Mongo is exactly what it would test true in JS.
 */
const fakeDb = (values: unknown[], fail = false): LanguageSpellingsSource => ({
  collection: () => ({
    distinct: async () => {
      if (fail) throw new Error('MaxTimeMSExpired');
      return values;
    },
  }),
});

// Real stored `books.language` values read off production (2026-09-25), plus
// the spellings the pattern exists to accept. The compound ones are the
// negative control: a substring or prefix match would claim every one of them.
const LIVE = ['Spanish', 'spanish', 'Español', 'Latin', 'Spanish / Latin', 'Spanish / French', 'Nahuatl-Spanish', 'Old Spanish', 'Spanish in Hebrew characters', null, 42];

describe('localizedEditionFilterIndexed', () => {
  it('selects exactly the spellings isNativeEdition accepts, as an indexable $in', async () => {
    const filter = await localizedEditionFilterIndexed(fakeDb(LIVE), 'es');
    const branches = (filter as { $or: Record<string, unknown>[] }).$or;
    expect(branches[0]).toEqual({ pages_translated_es: { $gt: 0 } });
    const inList = (branches[1] as { language: { $in: string[] } }).language.$in;
    expect(inList).toEqual(['Spanish', 'spanish', 'Español']);
    // The two readers of the rule agree on every value, matched or refused.
    for (const v of LIVE) {
      const js = typeof v === 'string' && isNativeEdition({ language: v }, 'es');
      expect(inList.includes(v as string)).toBe(js);
    }
    // Sanity: the loop above exercised both outcomes, not just one.
    expect(inList.length).toBeGreaterThan(0);
    expect(inList.length).toBeLessThan(LIVE.length);
  });

  it('yields an empty $in, not the regex, when no stored spelling matches', async () => {
    const filter = await localizedEditionFilterIndexed(fakeDb(['Latin', 'German']), 'es');
    const branches = (filter as { $or: Record<string, unknown>[] }).$or;
    expect(branches[1]).toEqual({ language: { $in: [] } });
  });

  it('falls back to the sync regex filter when distinct fails — slower, never wrong', async () => {
    const filter = await localizedEditionFilterIndexed(fakeDb([], true), 'es');
    expect(filter).toEqual(localizedEditionFilter('es'));
  });
});
