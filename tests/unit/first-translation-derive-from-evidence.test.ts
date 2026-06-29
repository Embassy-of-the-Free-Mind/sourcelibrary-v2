import { describe, it, expect } from 'vitest';
import { deriveVerdictFromAttempts } from '@/lib/first-translation/derive-from-evidence';
import { isFirstByVerdict, canPromoteToFirst } from '@/lib/first-translation/derive';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-06-29T00:00:00Z',
  method: 'tier1_catalog', match_key: 'author_title', sources_checked: [],
  result: 'none', evidence_strength: 'moderate', ...over,
});

// A book wrapper so we can run the downstream gates on a derived verdict.
const withVerdict = (ft: ReturnType<typeof deriveVerdictFromAttempts>): FirstTranslationBook => ({
  title: 'T', author: 'A', language: 'la', visible: true, pages_translated: 10,
  first_translation: ft ?? undefined,
} as FirstTranslationBook);

describe('deriveVerdictFromAttempts — verdict = f(accumulated evidence)', () => {
  it('empty pile → null (write nothing)', () => {
    expect(deriveVerdictFromAttempts([])).toBeNull();
  });

  it('"found" with no resolvable url → unverified → null (not a demote)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ result: 'found', priors: [{ english_title: 'Unsourced claim' }] }),
    ]);
    expect(ft).toBeNull();
  });

  it('a URL-checkable prior → not_first (single family = moderate)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'found', found_refs: ['cat:1'],
        priors: [{ english_title: 'The Foo', source_url: 'https://archive.org/x' }] }),
    ]);
    expect(ft?.verdict).toBe('not_first');
    expect(ft?.evidence_strength).toBe('moderate');
    expect(ft?.prior_refs).toEqual(['cat:1']);
    expect(isFirstByVerdict(withVerdict(ft))).toBe(false); // a defeat removes the badge
  });

  it('a prior found by TWO families → not_first, strong (cross-family agreement)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'found',
        priors: [{ english_title: 'Foo', source_url: 'https://archive.org/x' }] }),
      at({ method: 'tier2_agent', result: 'found', evidence_strength: 'strong', found_refs: ['cat:9'],
        priors: [{ english_title: 'Foo', source_url: 'https://worldcat.org/y' }] }),
    ]);
    expect(ft?.verdict).toBe('not_first');
    expect(ft?.evidence_strength).toBe('strong');
  });

  it('SINGLE-family absence (2 correlated catalog checks) → first_no_prior, WEAK — cannot auto-promote', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),                      // catalog family
      at({ method: 'gemini_verifier', result: 'none', queries: ['q'] }),    // ALSO catalog family
    ]);
    expect(ft?.verdict).toBe('first_no_prior');
    // Two methods but ONE family → weak (independence is by family, not count).
    expect(ft?.evidence_strength).toBe('weak');
    expect(isFirstByVerdict(withVerdict(ft))).toBe(true);   // badges...
    expect(canPromoteToFirst(withVerdict(ft))).toBe(false); // ...but never auto-promotes on weak
  });

  it('CROSS-family absence (catalog + agent) → first_no_prior, moderate — promotable', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),  // catalog
      at({ method: 'tier2_agent', result: 'none' }),    // agent (independent)
    ]);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('moderate');
    expect(ft?.resolver).toBe('tier2_agent'); // the independent family owns the verdict
    expect(canPromoteToFirst(withVerdict(ft))).toBe(true);
  });

  it('presence beats absence: a found prior + many absences → not_first', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),
      at({ method: 'tier2_agent', result: 'none' }),
      at({ method: 'human', result: 'found',
        priors: [{ english_title: 'Real prior', source_url: 'https://hdl.handle.net/z' }] }),
    ]);
    expect(ft?.verdict).toBe('not_first');
  });
});
