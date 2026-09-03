import { describe, it, expect } from 'vitest';
import {
  parseSkepticResponse, normalizeSkepticAttempt, buildSkepticPrompt,
  type SkepticResponse,
} from '@/lib/first-translation/skeptic';
const GROUNDED = { queries: ['q1', 'q2', 'q3'], sources: ['WorldCat', 'archive.org'] };

const resp = (over: Partial<SkepticResponse>): SkepticResponse => ({
  result: 'none_found', priors: [], queries_run: ['q1'], sources_consulted: [], ...over,
});

describe('parseSkepticResponse', () => {
  it('parses fenced and bare JSON, rejects garbage and off-enum results', () => {
    const json = '{"result":"none_found","priors":[],"queries_run":["a"],"sources_consulted":[]}';
    expect(parseSkepticResponse('```json\n' + json + '\n```')?.result).toBe('none_found');
    expect(parseSkepticResponse('prose then ' + json)?.result).toBe('none_found');
    expect(parseSkepticResponse('no json at all')).toBeNull();
    expect(parseSkepticResponse('{"result":"not_found"}')).toBeNull(); // off-contract value
  });
});

describe('normalizeSkepticAttempt — legal enums only (the ft-search-unexamined lesson)', () => {
  it('emits only legal result/match_key/method values', () => {
    for (const r of ['complete_prior_found', 'only_partial_exists', 'none_found', 'not_applicable', 'uncertain'] as const) {
      const { attempt } = normalizeSkepticAttempt(resp({ result: r }), GROUNDED);
      expect(['found', 'none', 'not_applicable']).toContain(attempt.result);
      expect(attempt.match_key).toBe('author_title');
      expect(attempt.method).toBe('gemini_grounded_search');
    }
  });

  it('a fully-documented complete prior → found/moderate, relationship carried', () => {
    const { attempt, problems } = normalizeSkepticAttempt(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'J. Freake', year: 1651, english_title: 'Three Books of Occult Philosophy', completeness: 'complete', relationship: 'same_text', source_url: 'https://archive.org/x' }],
    }), GROUNDED);
    expect(attempt.result).toBe('found');
    expect(attempt.evidence_strength).toBe('moderate');
    expect(problems).toEqual([]);
    expect((attempt.priors?.[0] as { relationship?: string }).relationship).toBe('same_text');
    expect(attempt.priors?.[0].pub_year).toBe('1651');
  });

  it('a prior without a parseable year clamps to weak and flags (first_modern rule)', () => {
    const { attempt, problems } = normalizeSkepticAttempt(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'Someone', english_title: 'X', completeness: 'complete', source_url: 'https://a/x' }],
    }), GROUNDED);
    expect(attempt.evidence_strength).toBe('weak');
    expect(problems.some((p) => p.startsWith('prior_without_year'))).toBe(true);
  });

  it('an illegal relationship value is dropped, never carried (it would default to defeating)', () => {
    const { attempt, problems } = normalizeSkepticAttempt(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'T', year: 1980, english_title: 'X', completeness: 'complete', relationship: 'sameish', source_url: 'https://a/x' }],
    }), GROUNDED);
    expect((attempt.priors?.[0] as { relationship?: string }).relationship).toBeUndefined();
    expect(problems).toContain('illegal_relationship:sameish');
  });

  it('strength is computed, never model-reported, and never strong', () => {
    // Even a perfect documented absence caps at moderate: one instrument is one family.
    const documented = normalizeSkepticAttempt(resp({ result: 'none_found' }), GROUNDED);
    expect(documented.attempt.evidence_strength).toBe('moderate');
    const undocumented = normalizeSkepticAttempt(resp({ result: 'none_found' }), { queries: [], sources: [] });
    expect(undocumented.attempt.evidence_strength).toBe('weak');
    expect(undocumented.problems).toContain('absence_without_documented_search');
  });

  it('uncertain keeps verdict:"uncertain" — "could not tell" is not "found nothing"', () => {
    const { attempt } = normalizeSkepticAttempt(resp({ result: 'uncertain' }), GROUNDED);
    expect(attempt.result).toBe('none');
    expect(attempt.verdict).toBe('uncertain');
    expect(attempt.evidence_strength).toBe('weak');
  });
});

describe('buildSkepticPrompt', () => {
  it('refute-frames the promote direction and lists claimed priors in the demote direction', () => {
    const rubric = 'RUBRIC-MARKER';
    const promote = buildSkepticPrompt({ id: 'x', title: 'T', author: 'A', language: 'Latin' }, rubric, { kind: 'refute_first' });
    expect(promote).toContain('REFUTE');
    expect(promote).toContain('RUBRIC-MARKER');
    const demote = buildSkepticPrompt({ id: 'x', title: 'T', author: 'A', language: 'Latin' }, rubric,
      { kind: 'verify_prior', claimedPriors: [{ english_title: 'Old Version', translator: 'N. N.', pub_year: '1900' }] });
    expect(demote).toContain('CLAIMED PRIOR(S) UNDER TEST');
    expect(demote).toContain('Old Version');
  });
});
