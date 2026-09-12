/**
 * #4695 — curated concept vocabulary. Pins the contract consumers rely on: the three tiers
 * stay distinct, `related` never leaks into expansion, no row below the confidence floor is
 * accepted, no malformed key survives, and the known false friends stay out.
 */
import { describe, it, expect } from 'vitest';
import { allConcepts, conceptFor, expandTerm, foldTerm } from '../../src/lib/concept-aliases';

const FLOOR = 0.7;

describe('concept-aliases data contract', () => {
  const concepts = allConcepts();

  it('has the 62 map concepts, each with a headword and tiers', () => {
    expect(concepts.length).toBe(62);
    for (const c of concepts) {
      expect(typeof c.concept).toBe('string');
      expect(Array.isArray(c.variants) && Array.isArray(c.equivalents) && Array.isArray(c.related)).toBe(true);
    }
  });

  it('accepted rows (variant/equivalent) are all at or above the confidence floor', () => {
    for (const c of concepts) for (const r of [...c.variants, ...c.equivalents]) expect(r.confidence, `${c.concept}: ${r.term}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('no accepted row carries a malformed key (parenthetical gloss, leading dash, colon)', () => {
    for (const c of concepts) for (const r of [...c.variants, ...c.equivalents]) expect(r.term, `${c.concept}: ${r.term}`).not.toMatch(/[()（）:;]|^[-–—]\s|\s[—–]\s/);
  });

  it('every accepted row has a reason', () => {
    for (const c of concepts) for (const r of [...c.variants, ...c.equivalents]) expect(r.reason.length, `${c.concept}: ${r.term}`).toBeGreaterThan(10);
  });

  it('known false friends are not accepted (people, homographs, over-broad words)', () => {
    const accepted = new Map<string, Set<string>>();
    for (const c of concepts) accepted.set(c.concept, new Set([...c.variants, ...c.equivalents].map((r) => r.term)));
    expect(accepted.get('hesychia')?.has('hesychius')).toBe(false);
    expect(accepted.get('initiation')?.has('mysteries')).toBe(false);
    expect(accepted.get('intellect')?.has('mens')).toBe(false);
    expect(accepted.get('mind')?.has('xin')).toBe(false);
    expect(accepted.get('masonic ritual')?.has('masonic')).toBe(false);
    expect(accepted.get('murāqaba')?.has('guan')).toBe(false);
  });
});

describe('expandTerm', () => {
  it('expands a transliterated headword to its scripts and renderings, tiered', () => {
    const x = expandTerm('samadhi');
    expect(x?.concept).toBe('samādhi');
    expect(x?.silent).toContain('samadhi');
    expect(x?.labelled).toContain('ting nge \'dzin');
    expect(x?.labelled).toContain('meditative absorption');
  });
  it('is reachable from a variant and from an equivalent', () => {
    expect(conceptFor('ἡσυχία')?.entry.concept).toBe('hesychia');
    expect(conceptFor('zikr')?.entry.concept).toBe('dhikr');
    expect(conceptFor('remembrance of God')?.tier).toBe('equivalent');
    expect(expandTerm('Samādhi')?.concept).toBe('samādhi'); // folding
  });
  it('never returns related terms', () => {
    const x = expandTerm('murāqaba');
    expect(x?.silent.concat(x.labelled)).not.toContain('theoria');
    expect(x?.silent.concat(x.labelled)).not.toContain('contemplatio');
  });
  it('returns null for an unknown term so callers fall through', () => {
    expect(expandTerm('zymurgy')).toBeNull();
  });
  it('foldTerm folds Latin only', () => {
    expect(foldTerm('Samādhi')).toBe('samadhi');
    expect(foldTerm('三昧')).toBe('三昧');
    expect(foldTerm('ἡσυχία')).toBe('ἡσυχία');
  });
});
