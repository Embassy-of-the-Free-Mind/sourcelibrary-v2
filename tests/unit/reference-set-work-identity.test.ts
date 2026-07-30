/**
 * Work-identity gold set for the reference-set search. (#3459)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The matcher was tuned five times by eyeballing samples. Every pass fixed a
 * visible artifact and introduced an invisible one:
 *
 *   1. coverage of OUR tokens only        → "Iliad." vs "Homer, Iliad with
 *                                           Scholia" scored 0.33; 8 matches found
 *   2. max(both directions)               → 74 matches, but any single-token
 *                                           record matched anything containing it
 *   3. romanized-Tibetan stoplist         → shrank book token lists, INFLATING
 *                                           hits/bookTokens: 187 → 726 Tibetan
 *   4. specificity floor on token counts  → lost Cicero's *De Officiis* (Grimald
 *                                           1556), Plutarch's *Moralia* (1561) and
 *                                           Della Porta entirely — verified true
 *                                           positives, silently restored to
 *                                           "no prior found"
 *
 * Step 4 is the dangerous one: it made the corpus look CLEANER while being
 * strictly more wrong, and nothing would have caught it. Tuning a ratio against
 * whichever sample you happened to read is not convergence.
 *
 * So the thresholds are now pinned to hand-verified pairs. Every LoC row below
 * is REAL MARC fetched from the 2016 MDSConnect dump; every book is a real badged
 * record. Any future change to the matcher must keep the positives and keep
 * rejecting the negatives, and will be measured rather than argued about.
 *
 * The negatives matter as much as the positives — they are the false-positive
 * classes that four of the five iterations produced.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  uniformTitleContainment,
  bookTitleTokens,
} from '../../scripts/lib/work-identity-match.mjs';

type LocRow = {
  lccn: string; title: string; uniform_title: string; year: string;
  original_languages: string[];
};

const rows: LocRow[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/reference-set/loc-gold-rows.json'), 'utf8'),
);

const byUniform = (re: RegExp) => {
  const hit = rows.find((r) => re.test(r.uniform_title || ''));
  if (!hit) throw new Error(`gold fixture missing a row with uniform_title matching ${re}`);
  return hit;
};

/**
 * Tokenisation comes from the lib itself. A local copy would let the test and
 * the implementation drift apart, which is how a green guard stops guarding.
 */
const bookTokens = (...titles: string[]) => bookTitleTokens(...titles);

describe('MUST MATCH — hand-verified prior English translations', () => {
  // Each of these was confirmed by reading the record. Losing any one means the
  // search reports "no prior found" for a work that has been in English for
  // centuries.
  const cases: Array<[string, RegExp, string[]]> = [
    ['Cicero, De Officiis → Grimald 1556', /^De officiis/i,
      ['De officiis. Add: Paradoxa Stoicorum. Hexastichon', 'De Officiis']],
    ['pseudo-Seneca, De formula honestae vitae → 1546', /^Formula vitae honestae/i,
      ['De quattuor virtutibus cardinalibus, sive De formula honestae vitae', 'De formula honestae vitae']],
    ['Plutarch, Moralia → Three morall treatises 1561', /^Moralia/i,
      ['Plutarchi Chaeronensis Moralia (Hercher edition)', 'Plutarchi Chaeronensis Moralia']],
    ['Euclid, Elements → Billingsley 1570', /^Elements/i,
      ['Elementa Euclides Geometriae, Planae ac Solidae', 'Στοιχεῖα (Elements)']],
    ['Boethius, Consolatio → 1609', /^De consolatione philosophiae/i,
      ['De Consolatione Philosophiae', 'De consolatione philosophiae']],
    ['Homer, Iliad → Chapman 1609', /^Iliad/i,
      ['Homer, Iliad with Scholia', 'The Iliad of Homer']],
    ['Della Porta, Magia Naturalis → Natural magick 1658', /^Magiae naturalis/i,
      ['Magia Naturalis. 2', 'Magia Naturalis']],
    ['Tibetan: Legs bshad gser phreng → Golden garland 2008', /^Legs bshad gser phreng/i,
      ['Neyphug Thor bu Legs bshad gser phreng', 'Neyphug Thor bu Legs bshad gser phreng']],
  ];

  it.each(cases)('%s', (_label, uniformRe, titles) => {
    const row = byUniform(uniformRe);
    const result = uniformTitleContainment(bookTokens(...titles), row.uniform_title);
    expect(result, `uniform title "${row.uniform_title}" should be contained in ${JSON.stringify(titles)}`)
      .not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('matches across Latin case-ending variation (magiae ⇔ magia)', () => {
    // Stemming earns its keep here: an exact-token rule would miss this.
    const row = byUniform(/^Magiae naturalis/i);
    expect(uniformTitleContainment(bookTokens('Magia Naturalis'), row.uniform_title)).not.toBeNull();
  });

  it('ignores word ORDER — a uniform title is a set, not a phrase', () => {
    // "Formula vitae honestae" vs our "De formula honestae vitae": substring
    // matching fails, set containment succeeds.
    const row = byUniform(/^Formula vitae honestae/i);
    expect(uniformTitleContainment(bookTokens('De formula honestae vitae'), row.uniform_title)).not.toBeNull();
  });
});

describe('MUST NOT MATCH — the false-positive classes the tuning produced', () => {
  it('rejects a French novel against a Tibetan ritual text (the "dregs" case)', () => {
    // "The cup to the dregs" matched at 1.00 because "dregs" is both an English
    // word and a romanized Tibetan syllable, and the record's display title
    // reduced to that single token.
    const row = byUniform(/^Calice/i);
    const result = uniformTitleContainment(
      bookTokens('Neyphug Thor bu Thugs sgrub dregs pa zil gnon'),
      row.uniform_title,
    );
    expect(result).toBeNull();
  });

  it('rejects a match resting only on generic Tibetan vocabulary', () => {
    // "ʼDod paʼi bstan bcos" ("Tibetan arts of love") vs an unrelated treatise.
    // `bstan bcos` just means "treatise" — the equivalent of matching on
    // "tractatus".
    const row = byUniform(/bstan bcos/i);
    const result = uniformTitleContainment(
      bookTokens("she bya rab tu gsal ba'I bstan bcos dang sen"),
      row.uniform_title,
    );
    expect(result).toBeNull();
  });

  it('rejects a same-author different-work pairing', () => {
    const row = byUniform(/^De officiis/i);
    expect(uniformTitleContainment(bookTokens('De natura deorum'), row.uniform_title)).toBeNull();
  });

  it('returns null rather than guessing when there is no uniform title', () => {
    // 32% of reference-set rows have no 240. Absent is not a match.
    expect(uniformTitleContainment(bookTokens('De Officiis'), '')).toBeNull();
    expect(uniformTitleContainment([], 'De officiis.')).toBeNull();
  });
});

describe('fixture integrity', () => {
  it('holds real LoC rows with LCCNs', () => {
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rows) expect(r.lccn, `row "${r.title}" has no LCCN`).toBeTruthy();
  });

  it('includes both positive and negative uniform titles', () => {
    expect(rows.some((r) => /^De officiis/i.test(r.uniform_title))).toBe(true);
    expect(rows.some((r) => /^Calice/i.test(r.uniform_title))).toBe(true);
  });
});
