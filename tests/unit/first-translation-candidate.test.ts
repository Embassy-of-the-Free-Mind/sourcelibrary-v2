/**
 * The CANDIDATE state: what may be claimed, and what must defeat it. (#3524)
 *
 * These are behavioural, not source-shape. Every case below fails if the guard
 * it covers is removed from `candidate.ts` — verified by deleting each branch in
 * turn (see the PR). The fixtures are the real populations the screens found on
 * 2026-08-03, not invented shapes.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyFirstTranslationClaim,
  hasFirstTranslationClaim,
  type ScreenedBook,
} from '../../src/lib/first-translation/candidate';

/** A plain foreign-language book with a full translation and no prior found. */
const FOREIGN: ScreenedBook = {
  language: 'Latin',
  pages_ocr: 100,
  pages_blank: 0,
  pages_translated: 100,
  source_language_screen: { verdict: 'foreign_source' },
};

describe('the default is candidate, and it is the common case', () => {
  it('a foreign book with no prior found is a candidate', () => {
    const r = classifyFirstTranslationClaim(FOREIGN);
    expect(r.claim).toBe('candidate');
    expect(r.reason).toBe('no_prior_found');
    expect(r.needsReview).toBe(false);
    expect(r.screensIncomplete).toBe(false);
  });

  it('a candidate is NOT confirmed — the two must be distinguishable', () => {
    expect(classifyFirstTranslationClaim(FOREIGN).claim).not.toBe('confirmed');
  });
});

describe('evidence that defeats the claim', () => {
  it('a found prior defeats it', () => {
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      first_translation: { verdict: 'not_first' },
    } as ScreenedBook);
    expect(r.claim).toBe('defeated');
    expect(r.reason).toBe('prior_found');
  });

  it('a found prior outranks a first-family verdict, not the other way round', () => {
    // Precedence is the design: the direction the instrument is RELIABLE in wins.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      first_translation: { verdict: 'not_first', evidence_strength: 'strong' },
    } as ScreenedBook);
    expect(r.claim).toBe('defeated');
  });

  it('measured already-English pages make the question inapplicable', () => {
    // Ganguli's *Mahābhārata*: catalogued Sanskrit, printed in English.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      language: 'Sanskrit',
      source_language_screen: { verdict: 'english_source' },
    });
    expect(r.claim).toBe('not_applicable');
    expect(r.reason).toBe('source_already_english');
  });

  it('a catalogued-English book the screen could not reach is inapplicable', () => {
    // No screen verdict — this branch exists only to catch books the measured
    // screen never reached. Where a screen HAS run it wins; see the next case.
    const { source_language_screen: _drop, ...noScreen } = FOREIGN;
    const r = classifyFirstTranslationClaim({ ...noScreen, language: 'English' });
    expect(r.claim).toBe('not_applicable');
    expect(r.reason).toBe('catalogued_english');
  });

  it('but the SCREEN outranks the catalogue when they disagree', () => {
    // `books.language` is the language of the WORK, not of the pages. A book
    // mislabelled English whose pages measure foreign stays a candidate.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      language: 'English',
      source_language_screen: { verdict: 'foreign_source' },
    });
    expect(r.claim).toBe('candidate');
  });
});

describe('a HOLD flags, it never excludes', () => {
  it('keeps the claim and asks for a human', () => {
    // Legge's *Chinese Classics*: bilingual, so the source screen correctly says
    // foreign, and only the translator screen can see it.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      language: 'Chinese',
      translator_author_screen: { verdict: 'hold' },
    });
    expect(r.claim).toBe('candidate');
    expect(r.needsReview).toBe(true);
    expect(r.reason).toBe('book_is_a_translation');
  });

  it('a hold does not silently become not_applicable', () => {
    // §17: never derive a destructive outcome from an unverified match. The
    // signal is noisy — a translator is often also an author.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      translator_author_screen: { verdict: 'hold' },
    });
    expect(r.claim).not.toBe('not_applicable');
    expect(r.claim).not.toBe('defeated');
  });
});

describe('"we could not ask" stays separate from "we asked and found nothing"', () => {
  it('an unscreened book is still a candidate, but flagged as unscreened', () => {
    const { source_language_screen: _drop, ...unscreened } = FOREIGN;
    const r = classifyFirstTranslationClaim(unscreened);
    expect(r.claim).toBe('candidate');
    expect(r.screensIncomplete).toBe(true);
    expect(r.reason).toBe('source_language_unscreened');
  });

  it('no OCR is unscreened, not a finding', () => {
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      source_language_screen: { verdict: 'no_ocr' },
    });
    expect(r.claim).toBe('candidate');
    expect(r.screensIncomplete).toBe(true);
  });

  it('undetermined is unscreened, not already-English', () => {
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      source_language_screen: { verdict: 'undetermined' },
    });
    expect(r.claim).toBe('candidate');
    expect(r.claim).not.toBe('not_applicable');
    expect(r.screensIncomplete).toBe(true);
  });

  it('a screened book is NOT flagged incomplete', () => {
    expect(classifyFirstTranslationClaim(FOREIGN).screensIncomplete).toBe(false);
  });
});

describe('monotonicity: new evidence only ever weakens a claim', () => {
  it('adding a found prior moves candidate -> defeated, never the reverse', () => {
    const before = classifyFirstTranslationClaim(FOREIGN).claim;
    const after = classifyFirstTranslationClaim({
      ...FOREIGN,
      first_translation: { verdict: 'not_first' },
    } as ScreenedBook).claim;
    expect(before).toBe('candidate');
    expect(after).toBe('defeated');
  });

  it('adding an english_source screen moves candidate -> not_applicable', () => {
    expect(
      classifyFirstTranslationClaim({
        ...FOREIGN,
        source_language_screen: { verdict: 'english_source' },
      }).claim,
    ).toBe('not_applicable');
  });
});

describe('confirmed is earned by EVIDENCE, not by carrying the badge', () => {
  /** A badged book — the render gate passes. Only evidence strength varies. */
  const badged = (evidence_strength?: string): ScreenedBook => ({
    ...FOREIGN,
    visible: true,
    is_first_translation: true,
    first_translation: { verdict: 'first_no_prior', evidence_strength },
  } as ScreenedBook);

  it('strong and moderate evidence confirm', () => {
    expect(classifyFirstTranslationClaim(badged('strong')).claim).toBe('confirmed');
    expect(classifyFirstTranslationClaim(badged('moderate')).claim).toBe('confirmed');
  });

  it('weak evidence does NOT confirm — it is a candidate', () => {
    // 2,286 of the 5,932 badged + visible books measured 2026-08-07.
    const r = classifyFirstTranslationClaim(badged('weak'));
    expect(r.claim).toBe('candidate');
    expect(r.reason).toBe('no_prior_found');
  });

  it('an unrecorded strength does not confirm', () => {
    expect(classifyFirstTranslationClaim(badged(undefined)).claim).toBe('candidate');
  });

  it('the legacy-disposition shim does not confirm', () => {
    // 2,957 badged books carry no verdict object at all; resolveFirstTranslation
    // synthesizes one and stamps it `weak` precisely because it was never
    // produced by a real adjudicator. Without this, gating on the render rule
    // alone made 95.8% of badged books "confirmed" — a state that meant only
    // "we badged it", which is the claim it exists to qualify.
    const r = classifyFirstTranslationClaim({
      ...FOREIGN,
      visible: true,
      is_first_translation: true,
      translation_verification: { disposition: 'confirmed_first' },
    } as ScreenedBook);
    expect(r.claim).toBe('candidate');
  });

  it('a badged book stays a claim — this qualifies it, it does not demote it', () => {
    expect(hasFirstTranslationClaim(badged('weak'))).toBe(true);
  });
});

describe('hasFirstTranslationClaim', () => {
  it('covers confirmed and candidate, excludes the rest', () => {
    expect(hasFirstTranslationClaim(FOREIGN)).toBe(true);
    expect(
      hasFirstTranslationClaim({
        ...FOREIGN,
        source_language_screen: { verdict: 'english_source' },
      }),
    ).toBe(false);
    expect(
      hasFirstTranslationClaim({
        ...FOREIGN,
        first_translation: { verdict: 'not_first' },
      } as ScreenedBook),
    ).toBe(false);
  });
});
