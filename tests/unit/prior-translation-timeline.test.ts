import { describe, it, expect } from 'vitest';
import { collectPriorTranslations } from '@/lib/prior-translation';
import type { PriorTranslationCredit } from '@/lib/types/book';

const credit = (over: Partial<PriorTranslationCredit> = {}): PriorTranslationCredit => ({
  work_title: 'The Work', translators: ['A Translator'], scope: 'complete',
  url: 'https://example.org/x', verification_method: 'worldcat', year: 1900,
  publisher: 'A Press', ...over,
} as PriorTranslationCredit);

const pick = (translator: string | null, pub_year: string | number | null, over = {}) =>
  ({ english_title: 'T', translator, pub_year, publisher: null, url: null, ...over });

describe('collectPriorTranslations — the timeline shows EVERY prior, oldest first', () => {
  it('returns every pick, not just the first', () => {
    const rows = collectPriorTranslations(null, [
      pick('Copenhaver', 2022), pick('More', 1510), pick('Someone', 1789),
    ]);
    expect(rows).toHaveLength(3);
  });

  // The regression this function exists for: the array is unordered, so [0] was
  // often a LATER translation shown under a heading reading "Earlier".
  it('orders oldest first even when the array leads with the latest', () => {
    const rows = collectPriorTranslations(null, [pick('Copenhaver', 2022), pick('More', 1510)]);
    expect(rows.map((r) => r.year)).toEqual(['1510', '2022']);
    expect(rows[0].pick?.translator).toBe('More');
  });

  it('a single pick still renders (no regression for the common case)', () => {
    const rows = collectPriorTranslations(null, [pick('Solo', 1850)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe('1850');
  });

  it('the curated credit is included alongside verification picks', () => {
    const rows = collectPriorTranslations(credit({ year: 1651 }), [pick('Later', 1990)]);
    expect(rows).toHaveLength(2);
    expect(rows[0].credit).toBeDefined();
    expect(rows[0].year).toBe('1651');
  });

  it('a pick duplicating the curated credit is dropped, and the CREDIT survives', () => {
    // The credit is the verified one and carries the outbound link, so it must win.
    const rows = collectPriorTranslations(
      credit({ translators: ['Jane Doe'], year: 1900 }),
      [pick('Jane Doe', 1900), pick('Other', 1975)],
    );
    expect(rows).toHaveLength(2);
    const nineteenHundred = rows.find((r) => r.year === '1900');
    expect(nineteenHundred?.credit).toBeDefined();
    expect(nineteenHundred?.pick).toBeUndefined();
  });

  it('duplicate picks collapse', () => {
    const rows = collectPriorTranslations(null, [pick('Same', 1800), pick('Same', 1800)]);
    expect(rows).toHaveLength(1);
  });

  it('undated priors sort last, never to the front of the timeline', () => {
    const rows = collectPriorTranslations(null, [pick('Undated', null), pick('Dated', 1600)]);
    expect(rows.map((r) => r.pick?.translator)).toEqual(['Dated', 'Undated']);
    expect(rows[1].ts).toBe(Number.POSITIVE_INFINITY);
    expect(rows[1].year).toBeNull();
  });

  it('several undated priors are all kept — they cannot be deduped by year', () => {
    const rows = collectPriorTranslations(null, [pick(null, null), pick(null, null)]);
    expect(rows).toHaveLength(2);
  });

  it('no evidence at all yields nothing (silence stays the fail direction)', () => {
    expect(collectPriorTranslations(null, [])).toEqual([]);
    expect(collectPriorTranslations(undefined, undefined)).toEqual([]);
  });

  it('a year embedded in prose still sorts correctly', () => {
    const rows = collectPriorTranslations(null, [pick('B', 'c. 1998'), pick('A', 'first printed 1592')]);
    expect(rows.map((r) => r.pick?.translator)).toEqual(['A', 'B']);
  });
});
