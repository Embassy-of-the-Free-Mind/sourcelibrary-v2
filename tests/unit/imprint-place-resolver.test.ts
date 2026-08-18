/**
 * The imprint-place resolver must read the VALUE's shape, not the column's
 * tier (#4043).
 *
 * The case that killed tier precedence, measured on 53 production books: the
 * catalogue field holds `s.l. (Germany)` — a true statement that the title
 * page names no place — while the import field holds the actual city.
 * Catalogue-wins would cite "place unknown" over Danzig. These tests pin the
 * opposite behaviour, plus the classifier edges that make it safe.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyImprintValue,
  resolveImprintPlace,
  IMPRINT_PLACE_PROJECTION,
} from '@/lib/imprint';

describe('classifyImprintValue', () => {
  it('classifies bare place-names as asserted', () => {
    for (const v of ['Danzig', 'Roma', 'Coloniae Agrippinae', 'Frankfurt am Main', 'Nürnberg']) {
      expect(classifyImprintValue(v)).toBe('asserted');
    }
  });

  it('classifies stated-absent markers, qualified or bracketed, as stated-absent', () => {
    for (const v of ['s.l.', 's.l. (Germany)', 'n.p.', '[n.p.]', 'z.p.', 'o.O.', 'sine loco', 'zonder plaats', 'No place', 'unknown', 'S. l.']) {
      expect(classifyImprintValue(v)).toBe('stated-absent');
    }
  });

  it('never mistakes a real place for a marker', () => {
    // Sneek (s.n…), Slaný (s.l…), Olomouc (o.o…), S. Gallen, Naples (n.p…-adjacent)
    for (const v of ['Sneek', 'Slaný', 'Olomouc', 'S. Gallen', 'Naples', 'Novi Pazar']) {
      expect(classifyImprintValue(v)).toBe('asserted');
    }
  });

  it('classifies bracketed and hedged apparatus as conjectural', () => {
    for (const v of ['[Frankfurt]', '[Halle? Helmstedt?]', '"Amsterdam" [= Hannover]', 'Danzig?']) {
      expect(classifyImprintValue(v)).toBe('conjectural');
    }
  });

  it('returns null for empty and non-string values', () => {
    expect(classifyImprintValue('')).toBeNull();
    expect(classifyImprintValue('   ')).toBeNull();
    expect(classifyImprintValue(null)).toBeNull();
    expect(classifyImprintValue(undefined)).toBeNull();
    expect(classifyImprintValue(42)).toBeNull();
  });
});

describe('resolveImprintPlace', () => {
  it('an asserted city beats a stated-absent marker in a more trusted column', () => {
    // The destructive case tier-precedence gets wrong.
    const r = resolveImprintPlace({
      publication_place: 's.l. (Germany)', // catalogue tier
      place_published: 'Danzig',           // import tier
    });
    expect(r).toMatchObject({ value: 'Danzig', field: 'place_published', shape: 'asserted' });
  });

  it('an asserted value beats a conjectural one', () => {
    // De occulta philosophia: fictitious imprint vs true printing.
    const r = resolveImprintPlace({
      publication_place: '[Cologne]',
      place_published: 'Lyon',
    });
    expect(r).toMatchObject({ value: 'Lyon', shape: 'asserted' });
  });

  it('within a shape, the more trusted column wins', () => {
    const r = resolveImprintPlace({
      publication_place: 'Roma',
      place_published: 'Rome',
    });
    expect(r).toMatchObject({ value: 'Roma', field: 'publication_place' });
  });

  it('falls back to conjectural, then stated-absent, when nothing better exists', () => {
    expect(resolveImprintPlace({ place_of_publication: '[Frankfurt]' })).toMatchObject({
      value: '[Frankfurt]',
      shape: 'conjectural',
    });
    expect(resolveImprintPlace({ publication_place: 's.l. (Germany)' })).toMatchObject({
      shape: 'stated-absent',
    });
  });

  it('resolves the 3,300-book case: a sibling field alone now cites', () => {
    const r = resolveImprintPlace({ place_of_publication: 'Amsterdam' });
    expect(r).toMatchObject({ value: 'Amsterdam', field: 'place_of_publication' });
  });

  it('returns null when the book holds nothing', () => {
    expect(resolveImprintPlace({})).toBeNull();
    expect(resolveImprintPlace(null)).toBeNull();
    expect(resolveImprintPlace({ place_published: '' })).toBeNull();
  });

  it('display joins multi-place strings and drops dangling separators, value stays verbatim', () => {
    const multi = resolveImprintPlace({ place_published: 'Frankfurt|Leipzig' });
    expect(multi?.value).toBe('Frankfurt|Leipzig');
    expect(multi?.display).toBe('Frankfurt and Leipzig');

    const dangling = resolveImprintPlace({ place_of_publication: '[Lyon?]|' });
    expect(dangling?.display).toBe('[Lyon?]');
  });

  it('never rewrites catalogue apparatus — the lie-marker survives to display', () => {
    const r = resolveImprintPlace({ publication_place: '"Amsterdam" [= Hannover]' });
    expect(r?.display).toBe('"Amsterdam" [= Hannover]');
  });

  it('projection fragment covers the whole family', () => {
    expect(IMPRINT_PLACE_PROJECTION).toEqual({
      publication_place: 1,
      place_of_publication: 1,
      place_published: 1,
      place: 1,
    });
  });
});
