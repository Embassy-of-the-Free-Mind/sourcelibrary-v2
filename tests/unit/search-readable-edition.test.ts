import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { collapseByWork } from '@/lib/search/work-grouping';
import {
  fetchTranslatedEditions,
  namesOneVolume,
  pickTranslatedEdition,
  readabilityTier,
  TIER_IMAGES_ONLY,
  TIER_PARTLY_TRANSLATED,
  TIER_READABLE,
  TIER_TEXT_ONLY,
} from '@/lib/search/readable-edition';

// Within one work, the edition a reader can read represents it (#5975).
//
// The motivating case is live (checked 2026-10-13): searching "Characteres
// Aegyptii" opens on Pignoria's 1608 copy, 1 of 138 pages translated, while the
// 1605 edition of the same work_id is translated. Search sent readers to the
// copy they could not read, and five of them wrote in asking for a translation
// we already had.
//
// As in search-work-grouping.test.ts, the cases that matter are the
// ABSTENTIONS: this swaps which book a reader is shown, so every case where it
// must NOT swap is a guard.

const state = (rung: string, english_original = false) => ({ translation_state: { rung, english_original } });

describe('readabilityTier', () => {
  it('reads the stored rung, not a ratio of its own', () => {
    expect(readabilityTier(state('complete'))).toBe(TIER_READABLE);
    expect(readabilityTier(state('readable'))).toBe(TIER_READABLE);
    expect(readabilityTier(state('translating'))).toBe(TIER_PARTLY_TRANSLATED);
    expect(readabilityTier(state('transcribed'))).toBe(TIER_TEXT_ONLY);
    expect(readabilityTier(state('transcribing'))).toBe(TIER_TEXT_ONLY);
    expect(readabilityTier(state('no_text'))).toBe(TIER_IMAGES_ONLY);
  });

  it('the rung wins over counters that disagree with it', () => {
    // The #5063 shape: a 25-page preview fully translated out of 300 pages.
    // The rung says `transcribing`; 25/25 must not read as readable.
    expect(readabilityTier({ ...state('transcribing'), pages_count: 25, pages_translated: 25 })).toBe(TIER_TEXT_ONLY);
  });

  it('an English original is readable once transcribed', () => {
    expect(readabilityTier(state('transcribed', true))).toBe(TIER_READABLE);
  });

  it('an unstamped book falls back to its counters at the 90% bar', () => {
    expect(readabilityTier({ pages_count: 100, pages_translated: 95 })).toBe(TIER_READABLE);
    expect(readabilityTier({ pages_count: 100, pages_translated: 40 })).toBe(TIER_PARTLY_TRANSLATED);
    expect(readabilityTier({ pages_count: 100, pages_ocr: 100, pages_translated: 0 })).toBe(TIER_TEXT_ONLY);
    expect(readabilityTier({ pages_count: 100 })).toBe(TIER_IMAGES_ONLY);
    expect(readabilityTier(null)).toBe(TIER_IMAGES_ONLY);
  });
});

describe('collapseByWork with betterRepresentative', () => {
  const row = (id: string, work_id: string | undefined, tier: number) => ({ book_id: id, id, work_id, tier });
  const moreReadable = (c: { tier: number }, p: { tier: number }) => c.tier < p.tier;

  it('the readable edition takes the row the oldest edition won', () => {
    const out = collapseByWork([
      row('pignoria-1608', 'W1', TIER_IMAGES_ONLY),
      row('pignoria-1605', 'W1', TIER_READABLE),
    ], { betterRepresentative: moreReadable });
    expect(out.results.map(r => r.id)).toEqual(['pignoria-1605']);
    expect(out.groups[0].primary.id).toBe('pignoria-1605');
    expect(out.groups[0].collapsed.map(r => r.id)).toEqual(['pignoria-1608']);
  });

  it('changes WHICH edition stands for a work, never WHERE the work sits', () => {
    const out = collapseByWork([
      row('other-work', 'W0', TIER_IMAGES_ONLY),
      row('w1-oldest', 'W1', TIER_IMAGES_ONLY),
      row('unkeyed', undefined, TIER_READABLE),
      row('w1-readable', 'W1', TIER_READABLE),
      row('last', 'W9', TIER_READABLE),
    ], { betterRepresentative: moreReadable });
    // A readable book further down does not jump over an unreadable one of a
    // different work: the ladder still decides between works.
    expect(out.results.map(r => r.id)).toEqual(['other-work', 'w1-readable', 'unkeyed', 'last']);
  });

  it('abstains between equally readable editions — the ranked first one stays', () => {
    const out = collapseByWork([
      row('older', 'W1', TIER_READABLE),
      row('newer', 'W1', TIER_READABLE),
    ], { betterRepresentative: moreReadable });
    expect(out.results.map(r => r.id)).toEqual(['older']);
  });

  it('picks the best of three, and keeps the collapsed rows in ranked order', () => {
    const out = collapseByWork([
      row('a-images', 'W1', TIER_IMAGES_ONLY),
      row('b-partly', 'W1', TIER_PARTLY_TRANSLATED),
      row('c-readable', 'W1', TIER_READABLE),
      row('d-text', 'W1', TIER_TEXT_ONLY),
    ], { betterRepresentative: moreReadable });
    expect(out.results.map(r => r.id)).toEqual(['c-readable']);
    expect(out.groups[0].collapsed).toHaveLength(3);
    expect(new Set(out.groups[0].collapsed.map(r => r.id))).toEqual(new Set(['a-images', 'b-partly', 'd-text']));
  });

  it('never swaps across works, and never touches a row with no work identity', () => {
    const out = collapseByWork([
      row('w1', 'W1', TIER_IMAGES_ONLY),
      row('w2', 'W2', TIER_READABLE),
      row('none-a', undefined, TIER_IMAGES_ONLY),
      row('none-b', undefined, TIER_READABLE),
    ], { betterRepresentative: moreReadable });
    expect(out.results.map(r => r.id)).toEqual(['w1', 'w2', 'none-a', 'none-b']);
    expect(out.groups).toHaveLength(0);
  });

  it('without the option nothing changes (positive control for the cases above)', () => {
    const out = collapseByWork([
      row('pignoria-1608', 'W1', TIER_IMAGES_ONLY),
      row('pignoria-1605', 'W1', TIER_READABLE),
    ]);
    expect(out.results.map(r => r.id)).toEqual(['pignoria-1608']);
  });
});

describe('pickTranslatedEdition', () => {
  const sib = (id: string, rung: string, year: number, extra: Record<string, unknown> = {}) => ({
    id, slug: `slug-${id}`, title: `Title ${id}`, published: String(year), year, work_id: 'W1', ...state(rung), ...extra,
  });

  it('a complete translation before a readable one, then the older edition', () => {
    expect(pickTranslatedEdition([sib('r-1550', 'readable', 1550), sib('c-1700', 'complete', 1700), sib('c-1600', 'complete', 1600)])?.book_id)
      .toBe('c-1600');
  });

  it('returns nothing when no sibling is translated to the readable bar', () => {
    expect(pickTranslatedEdition([sib('a', 'translating', 1500), sib('b', 'transcribed', 1501), sib('c', 'no_text', 1502)])).toBeNull();
    expect(pickTranslatedEdition([])).toBeNull();
  });

  it('never links a row to itself', () => {
    expect(pickTranslatedEdition([sib('self', 'complete', 1500)], 'self')).toBeNull();
  });

  it('does not call an English original a translated edition', () => {
    expect(pickTranslatedEdition([sib('english', 'complete', 1650, state('complete', true))])).toBeNull();
  });

  it('does not offer an artwork record as an edition to read', () => {
    expect(pickTranslatedEdition([sib('print', 'complete', 1650, { content_type: 'artwork' })])).toBeNull();
  });

  it('does not offer one volume of a set as the translated edition of another text', () => {
    // Measured 2026-10-13: under "Aristotle Metaphysics: Hebrew Translation" the
    // first run offered this volume, which shares a loose work_id and holds the
    // Ethics and Politics.
    const aldine = sib('aldine-6', 'complete', 1495, {
      title: 'Aristotelis Opera, Vol. 6 (Aldine, 1495): Ethica, Politica, Oeconomica',
      display_title: 'Works of Aristotle, Vol. 6, Aldine Edition: Nicomachean Ethics, Politics, Economics',
    });
    expect(pickTranslatedEdition([aldine])).toBeNull();
    // A whole edition beside it is still offered.
    expect(pickTranslatedEdition([aldine, sib('whole', 'readable', 1550)])?.book_id).toBe('whole');
  });

  it('namesOneVolume reads the marker, not the word', () => {
    for (const t of ['Opera, Vol. 6', 'Tomus II', 'Opera omnia, tomus 3', 'Band 2', 'Pars III', 'Volume 12', 'Zweiter Theil 2', 'Part 2', 'The Subterranean World Volume Two', 'Orationum volumen secundum', 'Tomus primus']) {
      expect(namesOneVolume(t), t).toBe(true);
    }
    for (const t of ['Volumen medicinae paramirum', 'De partibus animalium', 'Tomus', 'Bandello: Novelle', 'Monas Hieroglyphica', '', null]) {
      expect(namesOneVolume(t), String(t)).toBe(false);
    }
  });

  it('does not trust an unstamped sibling', () => {
    expect(pickTranslatedEdition([{ id: 'x', title: 'X', work_id: 'W1' }])).toBeNull();
  });

  it('carries what the link needs', () => {
    expect(pickTranslatedEdition([sib('a', 'complete', 1605, { display_title: 'Shown title' })])).toEqual({
      book_id: 'a', slug: 'slug-a', title: 'Shown title', published: '1605',
    });
  });
});

describe('fetchTranslatedEditions', () => {
  const fakeDb = (docs: Record<string, unknown>[], seen: { filter?: Record<string, unknown> } = {}) => ({
    collection() {
      return {
        find(filter: Record<string, unknown>) {
          seen.filter = filter;
          const chain = { limit: () => chain, maxTimeMS: () => chain, toArray: async () => docs };
          return chain;
        },
      };
    },
  }) as unknown as Db;

  it('maps each unreadable row to the translated sibling of ITS work', async () => {
    const seen: { filter?: Record<string, unknown> } = {};
    const db = fakeDb([
      { id: 'w1-translated', title: 'W1 translated', published: '1605', work_id: 'local-w1', ...state('complete') },
      { id: 'w2-translated', title: 'W2 translated', published: '1533', work_id: 'local-w2', ...state('readable') },
    ], seen);
    const out = await fetchTranslatedEditions(db, [
      { bookId: 'row-1', workId: 'local-w1' },
      { bookId: 'row-2', workId: 'local-w2' },
      { bookId: 'row-3', workId: 'local-w3' },
      { bookId: 'row-4', workId: undefined },
    ]);
    expect(out.get('row-1')?.book_id).toBe('w1-translated');
    expect(out.get('row-2')?.book_id).toBe('w2-translated');
    expect(out.has('row-3')).toBe(false);
    expect(out.has('row-4')).toBe(false);
    // The query is the live filter plus the readable rungs, by the indexed key.
    expect(seen.filter).toMatchObject({
      work_id: { $in: ['local-w1', 'local-w2', 'local-w3'] },
      visible: true,
      pages_count: { $gt: 0 },
      'translation_state.rung': { $in: ['readable', 'complete'] },
    });
  });

  it('returns nothing under a tenant, without touching the database', () => {
    const exploding = {
      collection() { throw new Error('a tenant request must not query the global corpus'); },
    } as unknown as Db;
    return expect(
      fetchTranslatedEditions(exploding, [{ bookId: 'row-1', workId: 'local-w1' }], { tenantScoped: true }),
    ).resolves.toEqual(new Map());
  });

  it('a Mongo error is no link, not a failed search', async () => {
    const failing = {
      collection() { return { find() { throw new Error('timeout'); } }; },
    } as unknown as Db;
    await expect(fetchTranslatedEditions(failing, [{ bookId: 'row-1', workId: 'local-w1' }])).resolves.toEqual(new Map());
  });

  it('asks nothing when no row carries a work id', async () => {
    const exploding = {
      collection() { throw new Error('no query expected'); },
    } as unknown as Db;
    await expect(fetchTranslatedEditions(exploding, [{ bookId: 'row-1', workId: null }])).resolves.toEqual(new Map());
  });
});
