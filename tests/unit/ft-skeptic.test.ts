import { describe, it, expect } from 'vitest';
import {
  parseSkepticResponse, normalizeSkepticAttempt, buildSkepticPrompt, buildFormatPrompt,
  SKEPTIC_PROMPT_VERSION, type SkepticResponse,
} from '@/lib/first-translation/skeptic';
import { deriveVerdictFromAttempts } from '@/lib/first-translation/derive-from-evidence';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

const BOOK: FirstTranslationBook = {
  title: 'De occulta philosophia', author: 'Agrippa von Nettesheim', language: 'Latin',
  visible: true, pages_translated: 10,
} as FirstTranslationBook;

const GROUNDED = { queries: ['q1', 'q2', 'q3'], sources: ['WorldCat', 'archive.org'] };

const resp = (over: Partial<SkepticResponse>): SkepticResponse => ({
  result: 'none_found', priors: [], queries_run: ['q1'], sources_consulted: [], ...over,
});

/** Build a full ledger row from a normalized skeptic result, as the driver does. */
const toRow = (r: SkepticResponse, grounded = GROUNDED): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-08-08T00:00:00Z',
  sources_checked: grounded.sources, queries: grounded.queries,
  prompt_version: SKEPTIC_PROMPT_VERSION,
  ...normalizeSkepticAttempt(r, grounded).attempt,
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

describe('ungrounded responses fail closed (run-1: 634/634 rows had zero API grounding)', () => {
  const UNGROUNDED = { queries: [], sources: [] };

  it('an ungrounded found — even with perfect-looking priors — is model knowledge: gemini_verifier, weak, flagged', () => {
    // Run 1 proved the model self-reports plausible queries_run and real-looking
    // URLs while executing ZERO searches. Without grounding, a URL is a token.
    const { attempt, problems } = normalizeSkepticAttempt(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'J. Freake', year: 1651, english_title: 'Three Books of Occult Philosophy', completeness: 'complete', relationship: 'same_text', source_url: 'https://archive.org/x' }],
    }), UNGROUNDED);
    expect(attempt.method).toBe('gemini_verifier');
    expect(attempt.evidence_strength).toBe('weak');
    expect(problems).toContain('ungrounded_response');
  });

  it('actuation pin: an ungrounded-found-only ledger derives NOTHING (weak hint defers)', () => {
    const row = toRow(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'T', year: 1992, english_title: 'X', completeness: 'complete', relationship: 'same_text', source_url: 'https://a/x' }],
    }), UNGROUNDED);
    expect(deriveVerdictFromAttempts([row], BOOK)).toBeNull();
  });

  it('v3 is two-phase: the search prompt asks for PROSE, never JSON (JSON suppresses grounding)', () => {
    expect(SKEPTIC_PROMPT_VERSION).toMatch(/\/v3-/);
    const p = buildSkepticPrompt({ id: 'x', title: 'T', author: 'A', language: 'Latin' }, 'R', { kind: 'refute_first' });
    expect(p).toContain('PLAIN PROSE');
    expect(p).not.toContain('Respond with ONLY JSON');
  });

  it('the phase-2 formatter is a formatter, not a second opinion', () => {
    const f = buildFormatPrompt('Research report text.');
    expect(f).toContain('ONLY facts the report explicitly states');
    expect(f).toContain('Respond with ONLY JSON');
    expect(f).toContain('Research report text.');
  });
});

describe('actuation pins (#3776 — rung 2 can never move a badge)', () => {
  // The nightly cron (scripts/workers/crontab.production) runs the reconcile with
  // --resolver=tier2_agent,human. These tests pin the OTHER half of that valve:
  // every verdict a rung-2-only ledger can produce carries a resolver outside
  // that set. If methodToResolver ever maps a gemini method into the admitted
  // set, this fails. (The crontab itself is not readable from a unit test —
  // changing the cron's --resolver list is a reviewed change by convention.)
  const CRON_VALVE_ADMITS = new Set(['tier2_agent', 'human']);

  it('a rung-2-only demote verdict resolves to tier1_catalog — outside the valve', () => {
    const row = toRow(resp({
      result: 'complete_prior_found',
      priors: [{ translator: 'V. Perrone Compagni', year: 1992, english_title: 'De occulta philosophia libri tres (English)', completeness: 'complete', relationship: 'same_text', source_url: 'https://brill.com/x' }],
    }));
    const ft = deriveVerdictFromAttempts([row], BOOK);
    expect(ft?.verdict).toBe('not_first');
    expect(ft?.resolver).toBe('tier1_catalog');
    expect(CRON_VALVE_ADMITS.has(ft!.resolver)).toBe(false);
  });

  it('a rung-2-only absence promotes nothing above weak first_no_prior, resolver outside the valve', () => {
    const ft = deriveVerdictFromAttempts([toRow(resp({ result: 'none_found' }))], BOOK);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('weak'); // one family, never more
    expect(CRON_VALVE_ADMITS.has(ft!.resolver)).toBe(false);
  });
});

describe('derive excludes uncertain rows from absence and refute votes', () => {
  const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
    attempt_id: 'a', book_id: 'b', date: '2026-06-29T00:00:00Z',
    method: 'tier1_catalog', match_key: 'author_title',
    sources_checked: ['search_local_catalogs'],
    result: 'none', evidence_strength: 'moderate', ...over,
  });

  it('an uncertain row alone derives nothing', () => {
    expect(deriveVerdictFromAttempts([toRow(resp({ result: 'uncertain' }))], BOOK)).toBeNull();
  });

  it('an agent-family uncertain row does not add an absence family', () => {
    const ft = deriveVerdictFromAttempts([
      at({}), // one real catalog absence
      at({ method: 'claude_subagent_verify', verdict: 'uncertain', queries: ['q'] }),
    ], BOOK);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('weak'); // still ONE family — uncertain excluded
  });

  it('an agent-family uncertain row does not refute a trustworthy found', () => {
    const ft = deriveVerdictFromAttempts([
      at({ result: 'found', found_refs: ['cat:1'], priors: [{ english_title: 'X', source_url: 'https://a/x' }] }),
      at({ method: 'claude_subagent_verify', verdict: 'uncertain', queries: ['q'] }),
    ], BOOK);
    // Without the exclusion this graded needs_review (a fake §17 refute).
    expect(ft?.verdict).toBe('not_first');
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
