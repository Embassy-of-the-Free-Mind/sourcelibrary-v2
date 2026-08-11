import { describe, it, expect } from 'vitest';
import { cardLabel, type TranslationCard } from '../../src/lib/first-translation/card';

const card = (over: Partial<TranslationCard> = {}): TranslationCard => ({
  _id: 'w1',
  work_id: 'w1',
  work_title: 'Test Work',
  status: 'no_prior_known',
  entries: [],
  search: { summary: 'Searched 4 catalogues; 2026-08-11.' },
  ...over,
});

const englished = { pages_translated: 100 };

describe('cardLabel — the one-sentence rule (#3881)', () => {
  it('empty card + English rendering → the honest first sentence', () => {
    const l = cardLabel(card(), englished)!;
    expect(l.register).toBe('first');
    expect(l.sentence).toMatch(/No earlier English translation .* known to us/);
    expect(l.searchSummary).toContain('Searched 4 catalogues');
  });

  it('empty card but NO English rendering → silence (nothing to badge)', () => {
    expect(cardLabel(card(), { pages_translated: 0 })).toBeNull();
  });

  it('prior_exists with entries → the priors register, earliest named', () => {
    const l = cardLabel(card({
      status: 'prior_exists',
      entries: [
        { title: 'Later tr.', translator: 'B', year: '1914' },
        { title: 'Earliest tr.', translator: 'A', year: '1650' },
      ],
    }), englished)!;
    expect(l.register).toBe('priors');
    expect(l.sentence).toContain('A (1650)');
    expect(l.entries).toHaveLength(2);
  });

  it('prior_exists with zero surviving entries (contradiction) → silence', () => {
    expect(cardLabel(card({ status: 'prior_exists', entries: [] }), englished)).toBeNull();
  });

  it('every unclean state fails toward SILENCE, never toward a claim', () => {
    for (const status of ['under_review', 'not_a_single_work', 'original_language_is_english', 'text_unidentified', 'anything_future']) {
      expect(cardLabel(card({ status }), englished)).toBeNull();
    }
  });

  it('no card at all → silence (legacy panel renders instead)', () => {
    expect(cardLabel(null, englished)).toBeNull();
  });
});
