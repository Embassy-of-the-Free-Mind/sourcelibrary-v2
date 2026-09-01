import { describe, it, expect } from 'vitest';
import {
  isFirstTranslation,
  isFirstByVerdict,
  isPublicFirst,
  canPromoteToFirst,
  firstTranslationVerdict,
  resolveFirstTranslation,
} from '@/lib/first-translation/derive';
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

  it('evidence-UNTRUSTWORTHY translation_found → needs_review, NOT a demotion (#2564 Arithmologia/Godwin)', () => {
    // The #2564 incident: a genuine first was demoted because its cited "prior"
    // was Godwin's *anthology*, not a translation of the specific work. The
    // evidence-quality guard (#2579) must catch an anthology-class prior and
    // escalate to needs_review rather than honor the not_first.
    const arithmologia: FirstTranslationBook = {
      visible: true, pages_translated: 50,
      title: 'Arithmologia', author: 'Athanasius Kircher', original_language: 'lat',
      translation_verification: {
        disposition: 'translation_found',
        translations_found: [
          { english_title: 'The Harmony of the Spheres: A Sourcebook of the Pythagorean Tradition', translator: 'Joscelyn Godwin', pub_year: '1993' },
        ],
      },
    };
    expect(firstTranslationVerdict(arithmologia)).toBe('needs_review');
    expect(isFirstTranslation(arithmologia)).toBe(false); // needs_review still doesn't badge

    // A clean, specific prior still demotes for real — the guard is not blanket-permissive.
    const realDemotion: FirstTranslationBook = {
      visible: true, pages_translated: 50,
      title: 'Arithmologia', author: 'Athanasius Kircher', original_language: 'lat',
      translation_verification: {
        disposition: 'translation_found',
        translations_found: [
          { english_title: 'Arithmologia, or the Mystical Properties of Numbers', translator: 'Jane Doe', pub_year: '1901', completeness: 'complete' },
        ],
      },
    };
    expect(firstTranslationVerdict(realDemotion)).toBe('not_first');
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
describe('canPromoteToFirst — bidirectional hygiene gate (#2564)', () => {
  it('promotes an evidence-backed adjudicated first', () => {
    const b: FirstTranslationBook = {
      visible: true, pages_translated: 10,
      first_translation: { verdict: 'first_no_prior', evidence_strength: 'strong', our_completeness: 'complete', match_key: 'work_id', resolver: 'tier2_agent' },
    };
    expect(canPromoteToFirst(b)).toBe(true);
  });

  it('BLOCKS promotion from a bare legacy disposition (the ~53%-wrong shim)', () => {
    // confirmed_first disposition with NO stored verdict object -> must not promote
    const b: FirstTranslationBook = { visible: true, pages_translated: 10, translation_verification: { disposition: 'confirmed_first' } };
    expect(isFirstByVerdict(b)).toBe(true);   // reads as first via the shim
    expect(canPromoteToFirst(b)).toBe(false); // but cannot be auto-promoted
  });

  it('BLOCKS promotion when evidence is weak even with a stored verdict', () => {
    const b: FirstTranslationBook = {
      visible: true, pages_translated: 10,
      first_translation: { verdict: 'first_no_prior', evidence_strength: 'weak', our_completeness: 'unknown', match_key: 'none', resolver: 'tier2_agent' },
    };
    expect(canPromoteToFirst(b)).toBe(false);
  });

  it('does not promote a non-first verdict', () => {
    const b: FirstTranslationBook = {
      visible: true, pages_translated: 10,
      first_translation: { verdict: 'not_first', evidence_strength: 'strong', our_completeness: 'unknown', match_key: 'work_id', resolver: 'tier2_agent' },
    };
    expect(canPromoteToFirst(b)).toBe(false);
  });
});
