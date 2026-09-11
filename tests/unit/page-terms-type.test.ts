/**
 * #4695 — typing page terms against the name tables, and the keep rules. Positive controls
 * in four non-Latin scripts because a join tested only on Latin passes while silently
 * mis-typing everything else (non-latin-text-operations.md); `unknown` must stay its own
 * bucket — an ambiguous or unjudgeable key is never folded into either verdict.
 */
import { describe, it, expect } from 'vitest';
import { buildNameIndex, typeTerm, nameKeys, isUnjudgeable } from '../../scripts/lib/page-terms-type.mjs';
import { KEEP_RULES } from '../../scripts/lib/page-terms-keep.mjs';

const index = buildNameIndex([
  { source: 'entities', id: 'e1', type: 'person', names: ['Aquilius'], weight: 46 },
  { source: 'entities', id: 'e2', type: 'place', names: ['Aquilius'], weight: 1 },
  { source: 'canonical_entities', id: 'Q220', type: 'place', names: ['Rome', 'Roma'], weight: 6301 },
  { source: 'authors', id: 'cicero', type: 'person', names: ['Cicero, Marcus Tullius', 'Cicero'], weight: 125 },
  { source: 'canonical_entities', id: 'Qm1', type: 'person', names: ['Mercury'], weight: 849 },
  { source: 'canonical_entities', id: 'Qm2', type: 'concept', names: ['Mercury'], weight: 630 },
  { source: 'entities', id: 'e3', type: 'concept', names: ['Hesychia'], weight: 7 },
  { source: 'entities', id: 'e4', type: 'person', names: ['Hesychia'], weight: 1 },
  { source: 'entities', id: 'e5', type: 'concept', names: ['Prima Materia', 'First Matter'], weight: 112 },
  // non-Latin names — exact NFC match, no case fold
  { source: 'canonical_entities', id: 'Q956', type: 'place', names: ['北京'], weight: 40 },
  { source: 'canonical_entities', id: 'Q1', type: 'person', names: ['ابن سينا'], weight: 30 },
  { source: 'canonical_entities', id: 'Q2', type: 'place', names: ['ירושלים'], weight: 50 },
  { source: 'canonical_entities', id: 'Q3', type: 'person', names: ['पतञ्जलि'], weight: 12 },
  { source: 'authors', id: 'x', type: 'weird', names: ['Ignored'], weight: 9 },
]);

describe('nameKeys', () => {
  it('folds Latin, keeps other scripts, inverts "Last, First"', () => {
    expect(nameKeys('Samādhi')).toEqual(['samadhi']);
    expect(nameKeys('Cicero, Marcus Tullius')).toEqual(['cicero, marcus tullius', 'marcus tullius cicero']);
    expect(nameKeys('ابن سينا')).toEqual(['ابن سينا']);
    expect(nameKeys('')).toEqual([]);
  });
});

describe('typeTerm', () => {
  it('positive controls from the handoff', () => {
    expect(typeTerm('aquilius', index)).toMatchObject({ type: 'person', source: 'entities', id: 'e1', weight: 46 });
    expect(typeTerm('prima materia', index)).toMatchObject({ type: 'concept', source: 'entities' });
    expect(typeTerm('三昧', index)).toMatchObject({ type: 'concept', source: 'unmatched' });
    expect(typeTerm('ذكر', index)).toMatchObject({ type: 'concept', source: 'unmatched' });
  });
  it('matches non-Latin names exactly (Chinese, Arabic, Hebrew, Devanagari)', () => {
    expect(typeTerm('北京', index).type).toBe('place');
    expect(typeTerm('ابن سينا', index).type).toBe('person');
    expect(typeTerm('ירושלים', index).type).toBe('place');
    expect(typeTerm('पतञ्जलि', index).type).toBe('person');
  });
  it('matches through aliases and inverted author forms', () => {
    expect(typeTerm('roma', index)).toMatchObject({ type: 'place', id: 'Q220' });
    expect(typeTerm('marcus tullius cicero', index)).toMatchObject({ type: 'person', id: 'cicero' });
  });
  it('decides by dominance and reports the alternatives', () => {
    expect(typeTerm('hesychia', index)).toMatchObject({ type: 'concept', weight: 7, alt: { concept: 7, person: 1 } });
  });
  it('ambiguous → unknown, never a coin flip', () => {
    expect(typeTerm('mercury', index)).toMatchObject({ type: 'unknown', source: 'ambiguous', alt: { person: 849, concept: 630 } });
  });
  it('unjudgeable keys → unknown, not concept', () => {
    expect(isUnjudgeable('!')).toBe(true);
    expect(isUnjudgeable('ab')).toBe(true);
    expect(isUnjudgeable('道')).toBe(false); // a single CJK character is a word; judge it
    expect(typeTerm('#', index)).toEqual({ type: 'unknown', source: 'unjudgeable' });
  });
  it('ignores records with a type outside person/place/concept', () => {
    expect(typeTerm('ignored', index)).toMatchObject({ type: 'concept', source: 'unmatched' });
  });
});

describe('KEEP_RULES.bridge', () => {
  const row = (o: Record<string, unknown>) => ({ term_key: 'x', kinds: {}, glosses: [], books: 1, original_verified: 0, non_latin: false, ...o });
  it('keeps a script bridge in ≥2 books, not in 1', () => {
    expect(KEEP_RULES.bridge(row({ term_key: '三昧', non_latin: true, books: 2, glosses: [{ gloss: 'Samadhi', n: 2 }] }))).toBe('bridge');
    expect(KEEP_RULES.bridge(row({ term_key: '三昧', non_latin: true, books: 1, glosses: [{ gloss: 'Samadhi', n: 1 }] }))).toBeNull();
    // a non-Latin gloss on a non-Latin term is not a bridge
    expect(KEEP_RULES.bridge(row({ term_key: '三昧', non_latin: true, books: 2, glosses: [{ gloss: '定', n: 2 }] }))).toBeNull();
  });
  it('keeps a synonym ring in ≥3 books', () => {
    expect(KEEP_RULES.bridge(row({ books: 3, glosses: [{ gloss: 'a' }, { gloss: 'b' }] }))).toBe('glosses2');
    expect(KEEP_RULES.bridge(row({ books: 2, glosses: [{ gloss: 'a' }, { gloss: 'b' }] }))).toBeNull();
  });
  it('keeps <term>-tagged / verified original in ≥3 books, anything in ≥10', () => {
    expect(KEEP_RULES.bridge(row({ books: 3, kinds: { term: 1 } }))).toBe('term3');
    expect(KEEP_RULES.bridge(row({ books: 3, original_verified: 2 }))).toBe('orig3');
    expect(KEEP_RULES.bridge(row({ books: 10 }))).toBe('books10');
    expect(KEEP_RULES.bridge(row({ books: 9 }))).toBeNull();
  });
  it('drops a one-off glossed motto that the pilot rule kept', () => {
    const motto = row({ books: 1, glosses: [{ gloss: 'It leaves, yet does not desert the city' }] });
    expect(KEEP_RULES.pilot(motto)).toBe('gloss');
    expect(KEEP_RULES.bridge(motto)).toBeNull();
  });
});
