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
  it('empty card + English rendering → the hedged catalog sentence', () => {
    const l = cardLabel(card(), englished)!;
    expect(l.register).toBe('first');
    expect(l.sentence).toBe('Possibly the first English translation — no earlier one is known to us.');
  });

  // The point of the 2026-09-04 hedge: the sentence must describe OUR search,
  // not the world. An unqualified superlative is falsified the moment anyone
  // finds a prior; this phrasing survives it as a card edit.
  it('the first-register sentence never asserts an unqualified superlative', () => {
    const l = cardLabel(card(), englished)!;
    expect(l.sentence).not.toMatch(/^the first english translation/i);
    expect(l.sentence.toLowerCase()).toMatch(/possibl|known to us/);
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
    expect(l.sentence).toBe('Earlier English translations: A (1650); B (1914).');
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
