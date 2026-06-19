import { describe, it, expect } from 'vitest';
import {
  isFirstTranslation,
  isFirstByVerdict,
  isPublicFirst,
  firstTranslationVerdict,
  resolveFirstTranslation,
} from '@/lib/first-translation/derive';
import { resolve, type Tier, type ResolvableBook } from '@/lib/first-translation/resolve';
import { strongestAttempt, type FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import type { FirstTranslation, FirstTranslationBook } from '@/lib/first-translation/types';

// A readable, visible book is the baseline; verdict objects vary per test.
function book(ft: Partial<FirstTranslation> | null, extra: Partial<FirstTranslationBook> = {}): FirstTranslationBook {
  return {
    visible: true,
    pages_translated: 100,
    first_translation: ft ? ({ ...ft } as FirstTranslation) : null,
    ...extra,
  };
}

const FT = (over: Partial<FirstTranslation>): FirstTranslation => ({
  verdict: 'first_no_prior',
  evidence_strength: 'strong',
  our_completeness: 'complete',
  match_key: 'work_id',
  resolver: 'tier2_agent',
  ...over,
});

describe('isFirstTranslation — render gate', () => {
  it('badges first-family verdicts with strong evidence', () => {
    expect(isFirstTranslation(book(FT({ verdict: 'first_no_prior' })))).toBe(true);
    expect(isFirstTranslation(book(FT({ verdict: 'first_from_source' })))).toBe(true);
    expect(isFirstTranslation(book(FT({ verdict: 'first_modern' })))).toBe(true);
  });

  it('does NOT badge non-first verdicts', () => {
    for (const v of ['not_first', 'not_applicable', 'unverifiable', 'needs_review'] as const) {
      expect(isFirstTranslation(book(FT({ verdict: v })))).toBe(false);
    }
  });

  it('gates first_complete on our item actually being complete', () => {
    expect(isFirstTranslation(book(FT({ verdict: 'first_complete', our_completeness: 'complete' })))).toBe(true);
    expect(isFirstTranslation(book(FT({ verdict: 'first_complete', our_completeness: 'partial' })))).toBe(false);
    expect(isFirstTranslation(book(FT({ verdict: 'first_complete', our_completeness: 'unknown' })))).toBe(false);
  });

  it('requires visible + translated pages (readers can read it)', () => {
    expect(isFirstTranslation(book(FT({}), { visible: false }))).toBe(false);
    expect(isFirstTranslation(book(FT({}), { pages_translated: 0 }))).toBe(false);
    expect(isFirstTranslation(book(FT({}), { pages_translated: null }))).toBe(false);
  });

  it('returns false when there is no verdict at all', () => {
    expect(isFirstTranslation(book(null))).toBe(false);
    expect(isFirstTranslation({})).toBe(false);
  });
});

describe('isFirstByVerdict — bibliographic claim (no render gate)', () => {
  it('ignores visibility and translated-pages (claim set on hidden books too)', () => {
    expect(isFirstByVerdict(book(FT({}), { visible: false }))).toBe(true);
    expect(isFirstByVerdict(book(FT({}), { pages_translated: 0 }))).toBe(true);
    // but the render gate still suppresses the badge on those:
    expect(isFirstTranslation(book(FT({}), { visible: false }))).toBe(false);
  });

  it('still applies the first_complete completeness gate', () => {
    expect(isFirstByVerdict(book(FT({ verdict: 'first_complete', our_completeness: 'partial' })))).toBe(false);
  });

  it('false for non-first verdicts', () => {
    expect(isFirstByVerdict(book(FT({ verdict: 'not_first' })))).toBe(false);
    expect(isFirstByVerdict(book(FT({ verdict: 'unverifiable' })))).toBe(false);
  });
});

describe('isPublicFirst — headline count (stricter)', () => {
  it('counts strong/moderate first-family claims', () => {
    expect(isPublicFirst(book(FT({ evidence_strength: 'strong' })))).toBe(true);
    expect(isPublicFirst(book(FT({ evidence_strength: 'moderate' })))).toBe(true);
  });

  it('excludes weak-evidence claims even though they still badge', () => {
    const weak = book(FT({ evidence_strength: 'weak' }));
    expect(isFirstTranslation(weak)).toBe(true); // still badges
    expect(isPublicFirst(weak)).toBe(false); // but not in the headline
  });

  it('excludes unverifiable (already not in the first-family)', () => {
    expect(isPublicFirst(book(FT({ verdict: 'unverifiable', evidence_strength: 'strong' })))).toBe(false);
  });
});

describe('legacy disposition fallback (transition compatibility)', () => {
  const legacy = (disposition: string): FirstTranslationBook => ({
    visible: true,
    pages_translated: 50,
    translation_verification: { disposition },
  });

  it('maps confirmed_first → first_no_prior and still badges', () => {
    expect(firstTranslationVerdict(legacy('confirmed_first'))).toBe('first_no_prior');
    expect(isFirstTranslation(legacy('confirmed_first'))).toBe(true);
  });

  it('evidence-BACKED translation_found → not_first (real demotion)', () => {
    const b: FirstTranslationBook = {
      visible: true, pages_translated: 50,
      translation_verification: { disposition: 'translation_found', translations_found: [{ translator: 'Gibson', year: '1894' }] },
    };
    expect(firstTranslationVerdict(b)).toBe('not_first');
    expect(isFirstTranslation(b)).toBe(false);
  });

  it('evidence-FREE translation_found → needs_review, NOT a demotion (de Serres class)', () => {
    // The cron set ~42% of translation_found with no recorded prior; treating
    // those as not_first wrongly demoted genuine firsts (Olivier de Serres).
    expect(firstTranslationVerdict(legacy('translation_found'))).toBe('needs_review');
    const withEmpty: FirstTranslationBook = {
      visible: true, pages_translated: 50,
      translation_verification: { disposition: 'translation_found', translations_found: [] },
    };
    expect(firstTranslationVerdict(withEmpty)).toBe('needs_review');
    expect(isFirstTranslation(withEmpty)).toBe(false); // needs_review still doesn't badge
  });

  it('treats legacy first_complete_translation as our-complete (passes the gate)', () => {
    expect(isFirstTranslation(legacy('first_complete_translation'))).toBe(true);
  });

  it('marks all legacy claims weak → excluded from the public count', () => {
    // This is the "public count rests on the weak path" finding made structural.
    expect(isFirstTranslation(legacy('confirmed_first'))).toBe(true);
    expect(isPublicFirst(legacy('confirmed_first'))).toBe(false);
  });

  it('prefers the new object over legacy disposition when both present', () => {
    const b: FirstTranslationBook = {
      visible: true,
      pages_translated: 10,
      first_translation: FT({ verdict: 'not_first' }),
      translation_verification: { disposition: 'confirmed_first' },
    };
    expect(firstTranslationVerdict(b)).toBe('not_first');
    expect(isFirstTranslation(b)).toBe(false);
  });

  it('returns null verdict for unrecognized / absent disposition', () => {
    expect(resolveFirstTranslation({ translation_verification: { disposition: 'bogus' } })).toBeNull();
    expect(resolveFirstTranslation({})).toBeNull();
  });
});

// ── attempt-log ranking ───────────────────────────────────────────────────

describe('strongestAttempt', () => {
  const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
    attempt_id: 'a',
    book_id: 'b',
    date: '2026-06-19T00:00:00Z',
    method: 'tier1_catalog',
    match_key: 'author_title',
    sources_checked: [],
    result: 'none',
    evidence_strength: 'weak',
    ...over,
  });

  it('prefers a positive found over any absence', () => {
    const found = at({ attempt_id: 'found', result: 'found', evidence_strength: 'weak' });
    const absence = at({ attempt_id: 'absence', result: 'none', evidence_strength: 'strong' });
    expect(strongestAttempt([absence, found])?.attempt_id).toBe('found');
  });

  it('among same result, prefers stronger evidence then better match_key', () => {
    const weakWork = at({ attempt_id: 'weakWork', evidence_strength: 'weak', match_key: 'work_id' });
    const strongFuzzy = at({ attempt_id: 'strongFuzzy', evidence_strength: 'strong', match_key: 'author_title' });
    expect(strongestAttempt([weakWork, strongFuzzy])?.attempt_id).toBe('strongFuzzy');

    const a = at({ attempt_id: 'work', evidence_strength: 'moderate', match_key: 'work_id' });
    const b = at({ attempt_id: 'fuzzy', evidence_strength: 'moderate', match_key: 'author_title' });
    expect(strongestAttempt([b, a])?.attempt_id).toBe('work');
  });

  it('returns null for an empty set', () => {
    expect(strongestAttempt([])).toBeNull();
  });
});

// ── tier router ─────────────────────────────────────────────────────────

describe('resolve — effort-tier cascade', () => {
  const NOW = '2026-06-19T12:00:00Z';
  const sampleBook: ResolvableBook = { visible: true, pages_translated: 10, id: 'bk1' };

  const mkTier = (
    id: string,
    verdict: FirstTranslation | null,
    terminal: boolean,
  ): Tier => async (b) => ({
    verdict,
    terminal,
    attempt: {
      attempt_id: id,
      book_id: (b.id as string) ?? 'x',
      date: NOW,
      method: id === 't0' ? 'tier0_linked' : id === 't1' ? 'tier1_catalog' : 'tier2_agent',
      match_key: 'work_id',
      sources_checked: [],
      result: verdict?.verdict === 'not_first' ? 'found' : 'none',
      evidence_strength: verdict?.evidence_strength ?? 'weak',
    },
  });

  it('stops at the first terminal tier and records its attempt only', async () => {
    const t0 = mkTier('t0', FT({ verdict: 'not_first', evidence_strength: 'strong' }), true);
    const t1 = mkTier('t1', FT({}), true);
    const { resolved, attempts } = await resolve(sampleBook, { tier0: t0, tier1: t1 }, { now: NOW });
    expect(resolved.verdict).toBe('not_first');
    expect(attempts).toHaveLength(1);
    expect(resolved.best_attempt_id).toBe('t0');
  });

  it('escalates to tier1 when tier0 is non-terminal', async () => {
    const t0 = mkTier('t0', null, false);
    const t1 = mkTier('t1', FT({ verdict: 'first_no_prior' }), true);
    const { resolved, attempts } = await resolve(sampleBook, { tier0: t0, tier1: t1 }, { now: NOW });
    expect(resolved.verdict).toBe('first_no_prior');
    expect(attempts.map((a) => a.attempt_id)).toEqual(['t0', 't1']);
  });

  it('forceTier2 runs the agent even when a cheap tier was terminal (sampler)', async () => {
    const t0 = mkTier('t0', FT({ verdict: 'first_no_prior', evidence_strength: 'weak' }), true);
    const t1 = mkTier('t1', null, false);
    const t2 = mkTier('t2', FT({ verdict: 'not_first', evidence_strength: 'strong' }), true);
    const { resolved, attempts } = await resolve(
      sampleBook,
      { tier0: t0, tier1: t1, tier2: t2 },
      { now: NOW, forceTier2: true },
    );
    expect(attempts.map((a) => a.attempt_id)).toEqual(['t0', 't1', 't2']);
    expect(resolved.verdict).toBe('not_first'); // tier2 ground truth wins
  });

  it('falls back to needs_review when no tier decides', async () => {
    const t0 = mkTier('t0', null, false);
    const t1 = mkTier('t1', null, false);
    const { resolved } = await resolve(sampleBook, { tier0: t0, tier1: t1 }, { now: NOW });
    expect(resolved.verdict).toBe('needs_review');
  });
});
