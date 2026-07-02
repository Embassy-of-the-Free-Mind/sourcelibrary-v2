import { describe, it, expect } from 'vitest';
import { deriveVerdictFromAttempts } from '@/lib/first-translation/derive-from-evidence';
import { isFirstByVerdict, canPromoteToFirst } from '@/lib/first-translation/derive';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

const BOOK: FirstTranslationBook = {
  title: 'Wubei Zhi', author: 'Mao Yuanyi', language: 'Chinese',
  visible: true, pages_translated: 10,
} as FirstTranslationBook;

const at = (over: Partial<FirstTranslationAttempt>): FirstTranslationAttempt => ({
  attempt_id: 'a', book_id: 'b', date: '2026-06-29T00:00:00Z',
  method: 'tier1_catalog', match_key: 'author_title',
  sources_checked: ['search_local_catalogs'],
  result: 'none', evidence_strength: 'moderate', ...over,
});

const withVerdict = (ft: ReturnType<typeof deriveVerdictFromAttempts>): FirstTranslationBook =>
  ({ ...BOOK, first_translation: ft ?? undefined } as FirstTranslationBook);

describe('deriveVerdictFromAttempts — hardened against the real ledger', () => {
  it('empty pile → null', () => {
    expect(deriveVerdictFromAttempts([], BOOK)).toBeNull();
  });

  // FAILURE MODE 1: a study miscounted as a prior must NOT demote a genuine first.
  it('weak "found" study with a URL does NOT demote (Needham-cites-it case)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'gemini_verifier', result: 'found', evidence_strength: 'weak',
        priors: [{ english_title: 'Science and Civilisation in China', source_url: 'https://archive.org/x' }],
        notes: '[legacy_tv] disposition=confirmed_first; No results from any of the 3' }),
    ], BOOK);
    // A weak found hint → defer (null), never not_first.
    expect(ft).toBeNull();
  });

  // A registry-backed (found_refs) non-weak prior IS trustworthy → not_first.
  it('non-weak prior with a registry found_ref → not_first', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'found', evidence_strength: 'moderate',
        found_refs: ['cat:1'], priors: [{ english_title: 'A real translation', source_url: 'https://archive.org/y' }] }),
    ], BOOK);
    expect(ft?.verdict).toBe('not_first');
    expect(ft?.prior_refs).toEqual(['cat:1']);
    expect(isFirstByVerdict(withVerdict(ft))).toBe(false);
  });

  it('two trustworthy families finding a prior → not_first, strong', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'found', evidence_strength: 'moderate', found_refs: ['cat:1'],
        priors: [{ english_title: 'X', source_url: 'https://a/x' }] }),
      at({ method: 'tier2_agent', result: 'found', evidence_strength: 'strong', found_refs: ['cat:2'],
        priors: [{ english_title: 'X', source_url: 'https://b/y' }] }),
    ], BOOK);
    expect(ft?.verdict).toBe('not_first');
    expect(ft?.evidence_strength).toBe('strong');
  });

  // FAILURE MODE 2: agent not_applicable must NOT count as an absence/promote.
  it('agent not_applicable (legacy notes form) → not_applicable, not a promote', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier2_agent', result: 'none', evidence_strength: 'strong',
        notes: 'not_applicable: the book is a 1629 reprint of the original' }),
      at({ method: 'tier1_catalog', result: 'none', evidence_strength: 'weak' }),
    ], BOOK);
    expect(ft?.verdict).toBe('not_applicable');
    expect(isFirstByVerdict(withVerdict(ft))).toBe(false);
  });

  it('agent not_applicable via the result field → not_applicable', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier2_agent', result: 'not_applicable', evidence_strength: 'strong' }),
    ], BOOK);
    expect(ft?.verdict).toBe('not_applicable');
  });

  // A weak/url-less "found" hint blocks a confident promote (Bacon/Davis case).
  it('an unconfirmable found hint blocks promotion → null (defer)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'gemini_verifier', result: 'found', evidence_strength: 'weak',
        priors: [{ english_title: 'Roger Bacon\'s Letter', translator: 'Tenney Davis', pub_year: '1923' }],
        notes: '[legacy_llm] unverified model knowledge' }),
      at({ method: 'tier1_catalog', result: 'none', evidence_strength: 'weak' }),
      at({ method: 'tier2_agent', result: 'none', evidence_strength: 'moderate' }),
    ], BOOK);
    expect(ft).toBeNull();
  });

  it('CLEAN cross-family absence (no found hint) → first_no_prior, moderate, promotable', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),   // catalog
      at({ method: 'tier2_agent', result: 'none' }),     // agent (independent)
    ], BOOK);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('moderate');
    expect(ft?.resolver).toBe('tier2_agent');
    expect(canPromoteToFirst(withVerdict(ft))).toBe(true);
  });

  it('single-family absence (2 correlated catalog checks) → first_no_prior, WEAK, NOT promotable', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),                   // catalog
      at({ method: 'gemini_verifier', result: 'none', queries: ['q'] }), // ALSO catalog family
    ], BOOK);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('weak');
    expect(isFirstByVerdict(withVerdict(ft))).toBe(true);
    expect(canPromoteToFirst(withVerdict(ft))).toBe(false);
  });

  // FAILURE MODE 2b: the legacy backfill's mid-notes NA form must also be caught.
  it('legacy "[legacy_ai] status=not_applicable; …" row is not an absence vote (Book of Kells case)', () => {
    const ft = deriveVerdictFromAttempts([
      // real legacy_tv catalog search that found nothing
      at({ method: 'gemini_verifier', evidence_strength: 'weak',
        notes: '[legacy_tv] disposition=translation_found; original English-language scholarly work' }),
      // legacy_ai judgment: FT does not apply — miscoded as result:none, no search
      at({ method: 'gemini_verifier', evidence_strength: 'weak', sources_checked: [],
        notes: '[legacy_ai] status=not_applicable; This book is an original publication in English.' }),
    ], BOOK);
    // Only ONE real absence family remains → weak → never promote-qualifying.
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('weak');
    expect(canPromoteToFirst(withVerdict(ft))).toBe(false);
  });

  // FAILURE MODE 3: an absence with no recorded search coverage is not evidence.
  it('result:none with no sources_checked and no queries → null (no absence evidence)', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'gemini_verifier', sources_checked: [], notes: '[legacy_llm] model belief: none known' }),
    ], BOOK);
    expect(ft).toBeNull();
  });

  it('queries alone count as coverage for an absence vote', () => {
    const ft = deriveVerdictFromAttempts([
      at({ method: 'gemini_verifier', sources_checked: [], queries: ['smith english translation 1650'] }),
    ], BOOK);
    expect(ft?.verdict).toBe('first_no_prior');
    expect(ft?.evidence_strength).toBe('weak');
  });

  it('not_applicable rows are excluded from the absence family count', () => {
    // one real catalog absence + one not_applicable (must not become a 2nd family)
    const ft = deriveVerdictFromAttempts([
      at({ method: 'tier1_catalog', result: 'none' }),
      at({ method: 'human', result: 'none', notes: 'not_applicable: original-language critical edition' }),
    ], BOOK);
    // human not_applicable yields a not_applicable verdict (rule 2 fires first).
    expect(ft?.verdict).toBe('not_applicable');
  });
});
