import { describe, it, expect } from 'vitest';
import { cardLabel, cardOutranksSearchNotice, type TranslationCard } from '../../src/lib/first-translation/card';

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

// #7797: "translated" means readable by a modern reader. A work whose only
// English is Middle English, early modern, or selections gets the first-modern
// sentence; one complete modern translation anywhere on the card takes it away.
describe('cardLabel: first in modern English (#7797)', () => {
  const bartholomaeus = card({
    status: 'antiquated_or_partial_only',
    entries: [
      { translator: 'Steele', title: 'Mediaeval Lore', year: '1893', register: 'modern', completeness: 'selections' },
      { translator: 'Batman', title: 'Batman uppon Bartholome', year: '1582', register: 'early_modern', completeness: 'complete' },
      { translator: 'Trevisa', title: 'On the Properties of Things', year: 'c.1398', register: 'middle_english', completeness: 'complete' },
    ],
  });

  it('Bartholomaeus: Middle English + early modern + selections → the first-modern sentence, oldest first', () => {
    const l = cardLabel(bartholomaeus, englished)!;
    expect(l.register).toBe('first_modern');
    expect(l.sentence).toBe(
      'Possibly the first complete English translation in modern English. '
      + 'Earlier English versions: Trevisa (c.1398, Middle English); Batman (1582, early modern English); Steele (1893, selections).',
    );
    expect(l.entries).toHaveLength(3);
    expect(cardOutranksSearchNotice(bartholomaeus, englished)).toBe(true);
  });

  it('lists at most three versions', () => {
    const l = cardLabel(card({
      status: 'antiquated_or_partial_only',
      entries: [1550, 1600, 1650, 1700].map((y) => ({ translator: `T${y}`, year: String(y), register: 'early_modern' as const })),
    }), englished)!;
    expect(l.sentence).toBe(
      'Possibly the first complete English translation in modern English. '
      + 'Earlier English versions: T1550 (1550, early modern English); T1600 (1600, early modern English); T1650 (1650, early modern English).',
    );
  });

  it('a complete modern translation on the card → prior_exists, never the first-modern sentence', () => {
    const mixed = card({
      ...bartholomaeus,
      entries: [...bartholomaeus.entries, { translator: 'Modern', title: 'Complete', year: '1990', register: 'modern', completeness: 'complete' }],
    });
    const l = cardLabel(mixed, englished)!;
    expect(l.register).toBe('priors');
    expect(l.sentence).not.toMatch(/first/i);
    expect(l.sentence).toBe('Earlier English translations: Trevisa (1398); Batman (1582); Steele (1893).');
    expect(cardOutranksSearchNotice(mixed, englished)).toBe(false);
  });

  it('an entry of unknown register and scope counts as modern and complete → prior_exists', () => {
    const l = cardLabel(card({
      status: 'antiquated_or_partial_only',
      entries: [{ translator: 'Trevisa', year: 'c.1398', register: 'middle_english' }, { translator: 'Unknown register', year: '1950' }],
    }), englished)!;
    expect(l.register).toBe('priors');
  });

  it('no pages translated → null', () => {
    expect(cardLabel(bartholomaeus, { pages_translated: 0 })).toBeNull();
    expect(cardOutranksSearchNotice(bartholomaeus, { pages_translated: 0 })).toBe(false);
  });

  it('no entries → null (an empty first-modern card is a contradiction)', () => {
    expect(cardLabel(card({ status: 'antiquated_or_partial_only', entries: [] }), englished)).toBeNull();
  });

  it('only the first-modern card outranks the fresh-search notice', () => {
    expect(cardOutranksSearchNotice(card(), englished)).toBe(false);
    expect(cardOutranksSearchNotice(card({ status: 'prior_exists', entries: [{ translator: 'A', year: '1650' }] }), englished)).toBe(false);
    expect(cardOutranksSearchNotice(null, englished)).toBe(false);
  });

  it('reader copy carries no em dash', () => {
    expect(cardLabel(bartholomaeus, englished)!.sentence).not.toContain('\u2014');
  });
});
