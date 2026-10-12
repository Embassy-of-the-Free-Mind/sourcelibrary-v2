/**
 * #4695 — curated concept vocabulary. Pins the contract consumers rely on: the three tiers
 * stay distinct, `related` never leaks into expansion, no row below the confidence floor is
 * accepted, no malformed key survives, and the known false friends stay out.
 */
import { describe, it, expect } from 'vitest';
import { allConcepts, conceptFor, conceptsInQuery, expandTerm, foldTerm } from '../../src/lib/concept-aliases';

const FLOOR = 0.7;

describe('concept-aliases data contract', () => {
  const concepts = allConcepts();

  it('has the 62 map concepts, the 41 body-practice concepts and daimōn (#4251), each with a headword and tiers', () => {
    expect(concepts.length).toBe(104);
    expect(concepts.filter((c) => c.theme === 'body').length).toBe(41);
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
    // daimōn (#4251): other traditions' beings, the word for talent, and happiness are not the Greek word.
    for (const t of ['genius', 'jinn', 'daeva', 'shedim', 'bdud', '鬼神', 'eudaimonia', 'numen']) expect(accepted.get('daimōn')?.has(t), t).toBe(false);
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

// #4251 — the report behind the issue: "daemon" did not reach the Vendidad, which says daēva.
// The vocabulary is SHOWN to the searcher, tier by tier; it is never folded into the query.
describe('conceptsInQuery', () => {
  it('names the concept from any of its spellings, and keeps the three tiers apart', () => {
    for (const q of ['daemon', 'Daemons', 'δαίμων', 'demon', 'daimōn']) {
      const [v, ...rest] = conceptsInQuery(q);
      expect(rest, q).toEqual([]);
      expect(v?.concept, q).toBe('daimōn');
      expect(v.same_word).toContain('δαίμων');
      expect(v.other_renderings).toEqual(expect.arrayContaining(['daemon', 'demon']));
      expect(v.related).toEqual(expect.arrayContaining(['daeva', 'jinn', 'shedim', 'bdud', '鬼神', 'genius']));
      const accepted = [...v.same_word, ...v.other_renderings];
      for (const t of v.related) expect(accepted, t).not.toContain(t);
    }
  });
  it('still expands only to accepted tiers: a daemon search must not become a daēva search', () => {
    const x = expandTerm('daemon')!;
    expect(x.concept).toBe('daimōn');
    for (const t of ['daeva', 'jinn', 'genius', 'daimonion']) expect(x.silent.concat(x.labelled)).not.toContain(t);
  });
  it('finds a concept named inside a sentence, on whole words only', () => {
    expect(conceptsInQuery('whether daemons are subject to passions').map((v) => v.concept)).toEqual(['daimōn']);
    expect(conceptsInQuery('remembrance of God in Sufi practice')[0]).toMatchObject({ concept: 'dhikr', matched: 'remembrance of God' });
    expect(conceptsInQuery('"prima materia"')).toEqual([]); // not a curated concept yet: say nothing
    expect(conceptsInQuery('pandemonium and demonstration')).toEqual([]); // never a substring
    expect(conceptsInQuery('')).toEqual([]);
  });
  it('returns at most two concepts and drops low-confidence related rows', () => {
    expect(conceptsInQuery('soul dream memory wisdom').length).toBe(2);
    const daimon = allConcepts().find((c) => c.concept === 'daimōn')!;
    const shown = conceptsInQuery('daemon')[0].related;
    for (const r of daimon.related) if (r.confidence < 0.6) expect(shown).not.toContain(r.term);
  });
  it('no accepted term belongs to two concepts (a query word names one concept or none)', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of allConcepts()) for (const r of [{ term: c.concept }, ...c.variants, ...c.equivalents]) {
      const k = foldTerm(r.term);
      const prev = owner.get(k);
      if (prev && prev !== c.concept && (c.concept === 'daimōn' || prev === 'daimōn')) clashes.push(`${r.term}: ${prev} / ${c.concept}`);
      owner.set(k, c.concept);
    }
    expect(clashes).toEqual([]);
  });
});
