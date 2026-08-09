import { describe, it, expect } from 'vitest';
import { attemptFamily, summarizePriorEvidence } from '@/lib/first-translation/prior-evidence';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';

const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-06-27T00:00:00Z', method: 'gemini_verifier',
  match_key: 'none', sources_checked: [], result: 'none', evidence_strength: 'weak', ...over,
});

describe('attemptFamily — independence by family, not raw method', () => {
  it('buckets the legacy backfill tags correctly', () => {
    expect(attemptFamily(at({ notes: '[legacy_ai] status=uncertain' }))).toBe('model_knowledge');
    expect(attemptFamily(at({ notes: '[legacy_llm] unverified model knowledge' }))).toBe('model_knowledge');
    expect(attemptFamily(at({ notes: '[legacy_tc] classification=previously_translated' }))).toBe('model_knowledge');
    expect(attemptFamily(at({ notes: '[legacy_tv] disposition=confirmed_first' }))).toBe('catalog');
    expect(attemptFamily(at({ notes: '[legacy_rp] verdict=not_first' }))).toBe('catalog');
  });

  it('disambiguates overloaded gemini_verifier by queries[]', () => {
    expect(attemptFamily(at({ method: 'gemini_verifier', queries: ['real search'] }))).toBe('catalog');
    expect(attemptFamily(at({ method: 'gemini_verifier', queries: [] }))).toBe('model_knowledge');
  });

  it('agent + human are their own families', () => {
    expect(attemptFamily(at({ method: 'tier2_agent' }))).toBe('agent');
    expect(attemptFamily(at({ method: 'human' }))).toBe('human');
  });

  it('deterministic registry matchers are all ONE catalog family (#3785)', () => {
    expect(attemptFamily(at({ method: 'tier0_linked' }))).toBe('catalog');
    expect(attemptFamily(at({ method: 'tier1_catalog' }))).toBe('catalog');
    // constituent_catalog_match was off-enum and fell to 'unknown' (familyTier 0).
    expect(attemptFamily(at({ method: 'constituent_catalog_match' }))).toBe('catalog');
  });

  it('three same-model-family absences = ONE independent family (no false confidence)', () => {
    const s = summarizePriorEvidence([
      at({ notes: '[legacy_ai] x' }), at({ notes: '[legacy_llm] y' }), at({ notes: '[legacy_tc] z' }),
    ]);
    expect(s.independentAbsenceMethods).toBe(1); // all method=gemini_verifier
    expect(s.independentAbsenceFamilies).toBe(1); // all model_knowledge — correctly ONE
  });

  it('catalog + agent absences = TWO independent families (real cross-family signal)', () => {
    const s = summarizePriorEvidence([
      at({ notes: '[legacy_tv] x' }), at({ method: 'tier2_agent', result: 'none' }),
    ]);
    expect(s.independentAbsenceFamilies).toBe(2);
  });

  it('foundFamilies counts cross-family agreement on a prior', () => {
    const s = summarizePriorEvidence([
      at({ notes: '[legacy_tc] x', result: 'found', priors: [{ english_title: 'T' }] }),
      at({ method: 'tier2_agent', result: 'found', evidence_strength: 'strong', priors: [{ english_title: 'T', source_url: 'https://x.org' }] }),
    ]);
    expect(s.foundFamilies).toBe(2); // model_knowledge + agent agree
  });
});
