import { describe, it, expect } from 'vitest';
import { summarizePriorEvidence } from '@/lib/first-translation/prior-evidence';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';

const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-06-27T00:00:00Z',
  method: 'tier2_agent', match_key: 'author_title', sources_checked: [],
  result: 'none', evidence_strength: 'moderate', ...over,
});

describe('summarizePriorEvidence — durable, approach-agnostic reuse', () => {
  it('empty pile → unverified, nothing to reuse', () => {
    const s = summarizePriorEvidence([]);
    expect(s.recommendation).toBe('unverified');
    expect(s.priorFound).toBe(false);
    expect(s.attemptCount).toBe(0);
  });

  it('a found prior WITH a real url → reuse_prior (presence is decisive)', () => {
    const s = summarizePriorEvidence([
      at({ method: 'gemini_verifier', result: 'found', evidence_strength: 'strong',
        priors: [{ english_title: 'The Foo', translator: 'Bar', pub_year: '1900', source_url: 'https://archive.org/x' }] }),
    ]);
    expect(s.recommendation).toBe('reuse_prior');
    expect(s.priorFound).toBe(true);
    expect(s.foundPrior?.english_title).toBe('The Foo');
  });

  it('a "found" prior with NO url does not count as reusable presence', () => {
    const s = summarizePriorEvidence([
      at({ result: 'found', priors: [{ english_title: 'Unsourced claim' }] }),
    ]);
    expect(s.priorFound).toBe(false);
    expect(s.recommendation).not.toBe('reuse_prior');
  });

  it('two DIFFERENT approaches finding none → absence_strong (independence)', () => {
    const s = summarizePriorEvidence([
      at({ method: 'gemini_verifier', result: 'none' }),
      at({ method: 'tier2_agent', result: 'none' }),
    ]);
    expect(s.independentAbsenceMethods).toBe(2);
    expect(s.recommendation).toBe('absence_strong');
  });

  it('two attempts from the SAME approach → still only weak (correlated)', () => {
    const s = summarizePriorEvidence([
      at({ method: 'gemini_verifier', result: 'none' }),
      at({ method: 'gemini_verifier', result: 'none' }),
    ]);
    expect(s.independentAbsenceMethods).toBe(1);
    expect(s.recommendation).toBe('absence_weak');
  });

  it('unions sources + queries across attempts so a new pass skips covered ground', () => {
    const s = summarizePriorEvidence([
      at({ method: 'gemini_verifier', result: 'none', sources_checked: ['worldcat', 'archive.org'], queries: ['q1'] }),
      at({ method: 'tier2_agent', result: 'none', sources_checked: ['archive.org', 'hathitrust'], queries: ['q1', 'q2'] }),
    ]);
    expect(s.searchedSources.sort()).toEqual(['archive.org', 'hathitrust', 'worldcat']);
    expect(s.searchedQueries.sort()).toEqual(['q1', 'q2']);
  });

  it('a real found-prior outranks absence even when absence is independent', () => {
    const s = summarizePriorEvidence([
      at({ method: 'gemini_verifier', result: 'none' }),
      at({ method: 'tier2_agent', result: 'none' }),
      at({ method: 'human', result: 'found', evidence_strength: 'strong',
        priors: [{ english_title: 'Real', source_url: 'https://worldcat.org/x' }] }),
    ]);
    expect(s.recommendation).toBe('reuse_prior');
  });
});
