/**
 * #5309: the gate that stands in for cli-ocr's 40% shared-words floor on a page the #3368 image repair stranded.
 * The stored text there is ANOTHER leaf's, so the floor refuses exactly the re-reads that fix it; the gate lifts it
 * only on model-free evidence from the book's own neighbours.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { strandedLift, leafTokens, sharedShare } from '../../scripts/lib/stranded-leaf-gate.mjs';

// Five distinct "leaves", each 30 distinct long words, so overlaps are exact.
const leaf = (k: number) => Array.from({ length: 30 }, (_, i) => `word${String.fromCharCode(97 + k)}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}xx`).join(' ');
const L = [0, 1, 2, 3, 4, 5].map(leaf);

describe('stranded-leaf-gate', () => {
  it('tokens are distinct folded long words', () => {
    expect(leafTokens('Hello Hello world ſtatus').size).toBe(3);
    expect(sharedShare(leafTokens(L[1]), leafTokens(L[1]))).toBe(1);
    expect(sharedShare(leafTokens(L[1]), leafTokens(L[2]))).toBe(0);
  });

  it('A: the stored text is a settled neighbour\'s leaf, and page n−d\'s pre-repair read corroborates the read → lift', () => {
    // page 3 stores leaf 2's text (offset −1); page 2 was re-read and holds leaf 2; page 4 was re-read too, and before
    // that it held leaf 3 (its revision); the read is leaf 3
    const g = strandedLift({ stored: L[2], read: L[3], neighbours: [{ id: 'p2', n: 2, d: -1, text: L[2], stranded: false }, { id: 'p4', n: 4, d: 1, text: L[4], stranded: false, history: [L[3]] }] });
    expect(g.lift).toBe(true);
    expect(g.evidence).toMatchObject({ kind: 'stored-is-neighbour', ref_n: 2, d: -1, corroborated_by: { n: 4, revision: true } });
  });

  it('A refuses an uncorroborated read: the stored text is wrong, but nothing says the read is right (pilot: an invented page)', () => {
    const g = strandedLift({ stored: L[2], read: L[5], neighbours: [{ id: 'p2', n: 2, d: -1, text: L[2], stranded: false }, { id: 'p4', n: 4, d: 1, text: L[4], stranded: false, history: [L[3]] }] });
    expect(g.lift).toBe(false);
    expect(g.why).toMatch(/corroborates/);
  });

  it('A refuses a read that is the same leaf as the neighbour', () => {
    const g = strandedLift({ stored: L[2], read: L[2], neighbours: [{ id: 'p2', n: 2, d: -1, text: L[2], stranded: false }] });
    expect(g.lift).toBe(false);
  });

  it('B: the read is the leaf parked on a still-stranded neighbour → lift', () => {
    // run of stranded pages at offset −1: page 4 stores leaf 3, which is page 3's own leaf (the read)
    const g = strandedLift({ stored: L[2], read: L[3], neighbours: [{ id: 'p2', n: 2, d: -1, text: L[1], stranded: true }, { id: 'p4', n: 4, d: 1, text: L[3], stranded: true }] });
    expect(g.lift).toBe(true);
    expect(g.evidence).toMatchObject({ kind: 'read-is-shifted-neighbour', ref_n: 4, d: 1 });
  });

  it('B never lifts when the read matches a SETTLED neighbour (the read is the wrong leaf)', () => {
    const g = strandedLift({ stored: L[5], read: L[4], neighbours: [{ id: 'p4', n: 4, d: 1, text: L[4], stranded: false }, { id: 'p2', n: 2, d: -1, text: L[0], stranded: true }] });
    expect(g.lift).toBe(false);
  });

  it('no evidence → no lift', () => {
    const g = strandedLift({ stored: L[5], read: L[3], neighbours: [{ id: 'p2', n: 2, d: -1, text: L[0], stranded: false }] });
    expect(g).toMatchObject({ lift: false });
  });
});
