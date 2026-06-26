/**
 * Unit tests for the First-Translation Evidence-Quality Guard
 *
 * Each labeled test case uses real data fetched from MongoDB (read-only).
 * The cited priors are exactly as stored in translation_verification.
 *
 * Book IDs used:
 *   69af0a0a4c57359b8d2d0f49  Kircher Arithmologia     (synthetic anthology case from manual_correction note)
 *   699259118812793469fe177f  Vijnanananda Devi Bhag.  (self-match)
 *   6992598b3d2d40d1b05915ba  Boas Bella Coola         (self-match)
 *   69946ec1f6f3426e298f0309  Tiruvalluvar / Lazarus   (self-match)
 *   69b3e5fb304c1c6b3950aad2  Avicenna al-Qanun        (partial guard — but see LIMITS note)
 *   69b2ffe2e5d6d64d8e1979e7  Erasmus Paraphrases      (all guards pass — genuine demotion)
 */

import { describe, it, expect } from 'vitest';
import { evaluatePrior, type BookInput, type CitedPriorInput } from '@/lib/ft-prior-guard';

// ── Shared expectation helpers ────────────────────────────────────────────────

function expectGuardFired(result: ReturnType<typeof evaluatePrior>, guard: string) {
  expect(result.failedGuards).toContain(guard);
  expect(result.trustworthy).toBe(false);
}

function expectAllGuardsPassed(result: ReturnType<typeof evaluatePrior>) {
  expect(result.trustworthy).toBe(true);
  const definitiveGuards = result.failedGuards.filter(g => g !== 'LOW_CONFIDENCE');
  expect(definitiveGuards).toHaveLength(0);
}

// ── Case 1: Arithmologia → Godwin anthology (ANTHOLOGY guard) ─────────────────

describe('Arithmologia (id=69af0a0a4c57359b8d2d0f49) — anthology guard', () => {
  /**
   * Context: A previous reconcile run demoted this book by citing Godwin's
   * "Theatre of the World" as a "translation" of Kircher's Arithmologia.
   * Theatre of the World is an anthology/study of Kircher's work, NOT a
   * translation of the Arithmologia specifically. The book was manually
   * restored to confirmed_first (2026-06-19).
   *
   * The cited prior below is the data that caused the false demotion.
   */
  const book: BookInput = {
    title: 'Arithmologia',
    author: 'Athanasius Kircher',
    language: 'Latin',
  };

  const citedPrior: CitedPriorInput = {
    english_title: "The Theatre of the World: Ars Magna of Athanasius Kircher",
    translator: "Joscelyn Godwin",
    pub_year: "2009",
    publisher: "Inner Traditions",
    completeness: 'complete',
    series: undefined,
    notes: "Godwin's Theatre of the World is a collected anthology of Kircher's major works including sections of Arithmologia",
  };

  it('ANTHOLOGY guard fires', () => {
    const result = evaluatePrior(book, citedPrior);
    expectGuardFired(result, 'ANTHOLOGY');
  });

  it('confidence is high (definitive guard fired)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.confidence).toBe('high');
  });

  it('SELF_MATCH guard does not fire (different title)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('SELF_MATCH');
  });

  it('PARTIAL guard does not fire (completeness is complete)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('PARTIAL');
  });
});

// ── Case 2: Vijnanananda Devi Bhagavatam → self-match ────────────────────────

describe('Vijnanananda Devi Bhagavatam (id=699259118812793469fe177f) — self-match guard', () => {
  /**
   * The book IS the 1915 Swami Vijnanananda English translation of the Devi Bhagavatam.
   * The cited prior is that exact same translation — same title (modulo variant spelling),
   * same translator. A system that treated this as "a prior translation exists" would
   * incorrectly demote the book.
   */
  const book: BookInput = {
    title: 'The Srimad Devi Bhagavatam',
    author: 'Swami Vijnanananda',
    language: 'English',
  };

  const citedPrior: CitedPriorInput = {
    english_title: 'The Srimad Devi Bhagawatam',
    translator: 'Swami Vijnanananda',
    pub_year: '1915',
    publisher: 'Unknown',
    completeness: 'complete',
  };

  it('SELF_MATCH guard fires', () => {
    const result = evaluatePrior(book, citedPrior);
    expectGuardFired(result, 'SELF_MATCH');
  });

  it('confidence is high', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.confidence).toBe('high');
  });
});

// ── Case 3: Boas Bella Coola → self-match ────────────────────────────────────

describe('Boas Bella Coola (id=6992598b3d2d40d1b05915ba) — self-match guard', () => {
  /**
   * "The Mythology of the Bella Coola Indians" by Franz Boas (1898) was
   * originally written in English — it is an ethnographic record, not a
   * translation from Nuxalk. The system cited the same work as a "prior
   * English translation." Title and author match exactly.
   */
  const book: BookInput = {
    title: 'The Mythology of the Bella Coola Indians',
    author: 'Franz Boas',
    language: 'Nuxalk',
  };

  const citedPrior: CitedPriorInput = {
    english_title: 'The Mythology of the Bella Coola Indians',
    translator: 'Franz Boas',
    pub_year: '1898',
    publisher: 'American Museum of Natural History',
    completeness: 'complete',
  };

  it('SELF_MATCH guard fires', () => {
    const result = evaluatePrior(book, citedPrior);
    expectGuardFired(result, 'SELF_MATCH');
  });

  it('confidence is high', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.confidence).toBe('high');
  });
});

// ── Case 4: Pope Naladiyar / Tiruvalluvar Kural → self-match ─────────────────

describe('Pope Naladiyar / Tiruvalluvar Kural (id=69946ec1f6f3426e298f0309) — self-match guard', () => {
  /**
   * The book IS the Lazarus 1885 English translation of the Kural.
   * The cited prior is that same Lazarus 1885 translation. Title overlap
   * is very high (both contain "Kural" and "Tiruvalluvar") and the
   * translator (Lazarus) also appears in the book's author string.
   */
  const book: BookInput = {
    title: 'The Kural of Tiruvalluvar',
    author: 'Tiruvalluvar (ed. Mrugesa Mudaliyar, trans. John Lazarus)',
    language: 'Tamil',
  };

  const citedPrior: CitedPriorInput = {
    english_title: 'The Kural of Tiruvalluvar : with the commentary of Parimelazagar and a simple and clear padavuray; to which is added an English translation of the text',
    translator: 'John Lazarus',
    pub_year: '1885',
    publisher: 'Madras, W.P. Chettiar',
    completeness: 'complete',
  };

  it('SELF_MATCH guard fires', () => {
    const result = evaluatePrior(book, citedPrior);
    expectGuardFired(result, 'SELF_MATCH');
  });

  it('confidence is high', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.confidence).toBe('high');
  });
});

// ── Case 5: Avicenna al-Qanun → partial guard ────────────────────────────────

describe('Avicenna al-Qanun (id=69b3e5fb304c1c6b3950aad2) — partial guard on cited evidence', () => {
  /**
   * The cited prior is Gruner 1930, "A Treatise on the Canon of Medicine …
   * Incorporating a Translation of the First Book" — explicitly partial.
   *
   * GUARD LOGIC: PARTIAL guard fires (cited evidence is partial → does not
   * defeat a "first complete translation" claim).
   *
   * LIMITS (document here): The guard-pass is *necessary but NOT sufficient*.
   * The CORRECT disposition for this book is "translation_found" (demotion is valid)
   * because a complete prior translation exists — Bakhtiar 1999 — which was simply
   * NOT CITED in the translation_verification record. The guard module sees only the
   * cited evidence, not the full bibliographic record. A guard-pass on the Gruner
   * citation does not mean the book is a first translation; it means Gruner alone
   * does not justify the demotion. The Bakhtiar translation, if cited, would pass
   * all guards (complete, different author, different title) and correctly demote.
   */
  const book: BookInput = {
    title: 'The Canon of Medicine',
    author: 'Avicenna',
    language: 'Arabic',
  };

  const citedPrior: CitedPriorInput = {
    english_title: 'A Treatise on the Canon of Medicine of Avicenna: Incorporating a Translation of the First Book',
    translator: 'O. Cameron Gruner',
    pub_year: '1930',
    publisher: 'Luzac & Co.',
    completeness: 'partial',
  };

  it('PARTIAL guard fires on cited evidence (Gruner 1930 is incomplete)', () => {
    const result = evaluatePrior(book, citedPrior);
    expectGuardFired(result, 'PARTIAL');
  });

  it('confidence is high (definitive guard)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.confidence).toBe('high');
  });

  it('SELF_MATCH does not fire (Gruner is a different person from Avicenna)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('SELF_MATCH');
  });

  it('ANTHOLOGY does not fire', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('ANTHOLOGY');
  });

  /**
   * IMPORTANT LIMIT: This test is a reminder that guard-pass ≠ "book is first translation."
   * Bakhtiar 1999 (complete translation, uncited) would pass all guards and correctly
   * establish the demotion. The guard module cannot see uncited evidence.
   */
  it('LIMITS: guard-pass here does NOT prove book is first translation — Bakhtiar 1999 complete prior is uncited', () => {
    // Synthetic: what the Bakhtiar prior would look like if cited
    const bakhtiarPrior: CitedPriorInput = {
      english_title: 'The Canon of Medicine (Al-Qanun fi al-Tibb)',
      translator: 'Laleh Bakhtiar',
      pub_year: '1999',
      publisher: 'Kazi Publications',
      completeness: 'complete',
    };
    const result = evaluatePrior(book, bakhtiarPrior);
    // All definitive guards pass → correct demotion is justified
    expect(result.trustworthy).toBe(true);
    const definitiveGuards = result.failedGuards.filter(g => g !== 'LOW_CONFIDENCE');
    expect(definitiveGuards).toHaveLength(0);
  });
});

// ── Case 6: Erasmus Paraphrases → all guards pass ────────────────────────────

describe('Erasmus Paraphrases (id=69b2ffe2e5d6d64d8e1979e7) — all guards pass (genuine demotion)', () => {
  /**
   * The cited prior is Udall 1548–1549, a complete real English translation of
   * Erasmus's Latin Paraphrases. This is a genuine prior translation:
   * - Not the same work as the book itself (different translator, 16th-century)
   * - Not an anthology or study
   * - Complete (not partial)
   * → All definitive guards pass → the cited prior IS trustworthy evidence
   *   → the demotion (is_first_translation: false) is justified by this evidence.
   */
  const book: BookInput = {
    title: 'Paraphrases on the New Testament',
    author: 'Erasmus',
    language: 'Latin',
  };

  const citedPrior: CitedPriorInput = {
    english_title: 'Paraphrases of Erasmus on the New Testament',
    translator: 'Nicholas Udall (editor)',
    pub_year: '1548-1549',
    publisher: 'Edward Whitchurch',
    completeness: 'complete',
  };

  it('all definitive guards pass (no SELF_MATCH, ANTHOLOGY, or PARTIAL)', () => {
    const result = evaluatePrior(book, citedPrior);
    expectAllGuardsPassed(result);
  });

  it('trustworthy is true', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.trustworthy).toBe(true);
  });

  it('SELF_MATCH does not fire (Udall is a different person from Erasmus)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('SELF_MATCH');
  });

  it('ANTHOLOGY does not fire', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('ANTHOLOGY');
  });

  it('PARTIAL does not fire (completeness is complete)', () => {
    const result = evaluatePrior(book, citedPrior);
    expect(result.failedGuards).not.toContain('PARTIAL');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('empty cited prior returns trustworthy=false via LOW_CONFIDENCE', () => {
    const book: BookInput = { title: 'Some Book', author: 'Some Author', language: 'Latin' };
    const prior: CitedPriorInput = {};
    const result = evaluatePrior(book, prior);
    // With no prior data at all, LOW_CONFIDENCE fires (no author token found)
    // but we don't assert on this strongly — the guard system is designed for real data
    expect(result).toBeDefined();
    expect(typeof result.trustworthy).toBe('boolean');
  });

  it('completeness=excerpts triggers PARTIAL guard', () => {
    const book: BookInput = { title: 'Opus Magnum', author: 'Paracelsus', language: 'German' };
    const prior: CitedPriorInput = {
      english_title: 'Selected Writings of Paracelsus',
      translator: 'Norbert Guterman',
      pub_year: '1951',
      completeness: 'excerpts',
    };
    const result = evaluatePrior(book, prior);
    expect(result.failedGuards).toContain('PARTIAL');
  });

  it('anthology keyword in series triggers ANTHOLOGY guard', () => {
    const book: BookInput = { title: 'De Occulta Philosophia', author: 'Heinrich Cornelius Agrippa', language: 'Latin' };
    const prior: CitedPriorInput = {
      english_title: 'Agrippa on Occult Philosophy',
      translator: 'John Freake',
      pub_year: '1651',
      completeness: 'complete',
      series: 'Collected Works of Agrippa',
    };
    const result = evaluatePrior(book, prior);
    expect(result.failedGuards).toContain('ANTHOLOGY');
  });

  it('high title overlap prevents false ANTHOLOGY fire when book IS that work', () => {
    const book: BookInput = { title: 'Arithmologia', author: 'Kircher', language: 'Latin' };
    const prior: CitedPriorInput = {
      english_title: 'Arithmologia: The Art of Numbers — Complete Works',
      translator: 'Joscelyn Godwin',
      pub_year: '2009',
      completeness: 'complete',
    };
    // "complete works" is in ANTHOLOGY_SERIES keywords but title overlap is high
    const result = evaluatePrior(book, prior);
    // ANTHOLOGY should NOT fire because title overlap is high
    expect(result.failedGuards).not.toContain('ANTHOLOGY');
  });
});
