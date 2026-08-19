/**
 * What actually defeats a first-translation claim (#3687, 2026-08-08).
 *
 * Written after three badges came off overnight that should not have. The
 * grader keyed on a found sighting and the priors' YEARS, and never read the two
 * fields the model documents as decisive:
 *
 *   completeness  — the ft-verify contract has always said a demote requires
 *                   `confirmed_complete`; the grader never checked it, so an
 *                   `excerpt` defeated a claim exactly as a complete edition did.
 *   relationship  — types.ts documents PriorRelationship as the field that
 *                   "determines whether the candidate defeats first", and the
 *                   grader hardcoded `same_text` (always defeats) while the
 *                   ingest dropped the agent's actual judgement.
 *
 * Measured blast radius before the fix: of 429 books graded `not_first`, 31 had
 * NO complete prior anywhere (7 already demoted) and 44 had priors of unknown
 * completeness (36 already demoted).
 *
 * Every case below is a real book from that audit.
 */
import { describe, it, expect } from 'vitest';

import { priorDefeatsClaim } from '@/lib/first-translation/derive-from-evidence';

type Prior = Parameters<typeof priorDefeatsClaim>[0];
const prior = (o: Partial<Prior> & Record<string, unknown>) =>
  ({ english_title: 'X', ...o }) as Prior;

describe('completeness: a fragment cannot defeat a first-translation claim', () => {
  it('al-Jahiz — every English rendering is an excerpt, so none defeats', () => {
    // Kitab al-Hayawan: Kopf 1953 (excerpt), Montgomery 2013 (partial). No
    // complete seven-volume English translation exists in any catalogue, and
    // this book was demoted anyway.
    expect(priorDefeatsClaim(prior({ translator: 'Lothar Kopf', pub_year: '1953', completeness: 'excerpt' }))).toBe(false);
    expect(priorDefeatsClaim(prior({ translator: 'James E. Montgomery', pub_year: '2013', completeness: 'partial' }))).toBe(false);
  });

  it('a complete prior DOES defeat', () => {
    expect(priorDefeatsClaim(prior({ translator: 'P.G. Walsh', pub_year: '1999', completeness: 'complete' }))).toBe(true);
  });

  it('unknown completeness does NOT defeat — "we could not tell" is not "complete"', () => {
    // 44 books sat in this state, 36 of them already demoted. An unrun check
    // must never read as a finding.
    expect(priorDefeatsClaim(prior({ translator: 'A B', pub_year: '1980', completeness: 'unknown' }))).toBe(false);
    expect(priorDefeatsClaim(prior({ translator: 'A B', pub_year: '1980' }))).toBe(false);
  });
});

describe('relationship: a complete prior of the WRONG text cannot defeat either', () => {
  it('Secretum secretorum — Kerns 2008 renders Yonge\'s Middle English, not the Latin', () => {
    // Complete, post-1900, and verified as translating a different witness.
    // Recorded faithfully, read as a defeater, badge removed.
    expect(priorDefeatsClaim(prior({
      translator: 'Linda K. Kerns', pub_year: '2008', completeness: 'complete',
      relationship: 'different_source_language',
    }))).toBe(false);
  });

  it('a prior on a related but distinct work does not defeat', () => {
    // Peers 1923 translates the Llibre d'amic e amat, embedded in Blanquerna —
    // not the Llibre de contemplacio at all.
    expect(priorDefeatsClaim(prior({
      translator: 'E. Allison Peers', pub_year: '1923', completeness: 'complete',
      relationship: 'related_distinct_work',
    }))).toBe(false);
  });

  it('same_text and same_work_diff_edition DO defeat', () => {
    for (const relationship of ['same_text', 'same_work_diff_edition']) {
      expect(priorDefeatsClaim(prior({ pub_year: '1990', completeness: 'complete', relationship })), relationship).toBe(true);
    }
  });

  it('an ABSENT relationship keeps the defeating default', () => {
    // Deliberate. Most historical rows predate the field, and silently reversing
    // them would be its own mass rewrite. Absence is not evidence of a
    // non-defeating relationship.
    expect(priorDefeatsClaim(prior({ pub_year: '1990', completeness: 'complete' }))).toBe(true);
  });

  it('relationship cannot rescue a fragment — both conditions must hold', () => {
    expect(priorDefeatsClaim(prior({ pub_year: '1990', completeness: 'partial', relationship: 'same_text' }))).toBe(false);
  });
});
