/**
 * SOURCE_LANG guard: both sides must resolve to the same ISO bucket (#3460).
 *
 * The bug: `scripts/eval/ft-catalog-match.mjs` resolved the BOOK's language to
 * an ISO code via a private table, then compared that against the catalog row's
 * `source_language` string *as stored*. Rows written with a human display name
 * ("Sanskrit", "Greek", "Latin") therefore failed the guard against every book
 * in the corpus.
 *
 * Blast radius measured against production on 2026-07-29: 305 rows, all of
 * `source: 'claude_subagent_verify'` — the hand-verified batch — carrying 213 of
 * the catalogue's 385 `completeness: 'complete'` rows. Since COMPLETENESS is the
 * guard that actually defeats a first-translation claim, 55% of the rows strong
 * enough to demote a badge could never be reached. Running the real matcher
 * before/after the fix moved the corpus-wide demote-candidate count from 0 to 2.
 *
 * These tests exercise the real exported matcher against real row shapes. They
 * are deliberately NOT source-shape assertions: the failure mode here is a
 * guard that returns the wrong answer, which a grep for a line of code cannot
 * see (see "A test that greps source is not a guard" in CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { buildCatalogIndex, matchBookToCatalog } from '../../scripts/eval/ft-catalog-match.mjs';
// @ts-expect-error — .mjs script module without type declarations
import { toSourceIso, buildCatalogDoc } from '../../scripts/lib/translation-catalog-record.mjs';

describe('toSourceIso', () => {
  it('maps display names to ISO buckets', () => {
    expect(toSourceIso('Sanskrit')).toBe('sa');
    expect(toSourceIso('Greek')).toBe('grc');
    expect(toSourceIso('Ancient Greek')).toBe('grc');
    expect(toSourceIso('Latin')).toBe('la');
    expect(toSourceIso('Classical Chinese')).toBe('zh');
    expect(toSourceIso('Tibetan')).toBe('bo');
  });

  it('is idempotent on values already in ISO form', () => {
    for (const iso of ['la', 'grc', 'sa', 'bo', 'zh', 'he', 'arc']) {
      expect(toSourceIso(iso)).toBe(iso);
    }
  });

  it('drops qualifying parentheticals', () => {
    // Real production values from the claude_subagent_verify batch.
    expect(toSourceIso("Mandaic (via Lidzbarski's German)")).toBe('myz');
    expect(toSourceIso('Middle English (French-derived recension)')).toBe('enm');
  });

  it('takes the leading segment of a compound source', () => {
    expect(toSourceIso('Latin/German')).toBe('la');
    expect(toSourceIso('Latin-Dutch')).toBe('la');
    expect(toSourceIso('Nahuatl/Latin')).toBe('nah');
  });

  it('returns null rather than guessing on an unmappable value', () => {
    // Reported by the repair sweep, deliberately left unresolved.
    expect(toSourceIso('Mixtec (pictographic; via Spanish)')).toBeNull();
    expect(toSourceIso('')).toBeNull();
    expect(toSourceIso(undefined)).toBeNull();
  });
});

describe('buildCatalogDoc source_language', () => {
  const base = {
    source: 'test',
    author: 'Patanjali',
    english_title: 'The Yoga Sutras of Patanjali',
    translator: 'Someone',
    pub_year: '1914',
  };

  it('stores the ISO bucket even when handed a display name', () => {
    // This is the regression: the ft-verify ingest fed display names straight
    // through, so rows were born unmatchable.
    const doc = buildCatalogDoc({ ...base, source_language: 'Sanskrit' });
    expect(doc.source_language).toBe('sa');
    expect(doc.source_language_raw).toBe('Sanskrit');
  });

  it('does not set source_language_raw when the input was already ISO', () => {
    const doc = buildCatalogDoc({ ...base, source_language: 'sa' });
    expect(doc.source_language).toBe('sa');
    expect(doc.source_language_raw).toBeUndefined();
  });

  it('throws on a source_language it cannot resolve', () => {
    expect(() => buildCatalogDoc({ ...base, source_language: 'Klingon' })).toThrow(/invalid source_language/);
  });
});

describe('SOURCE_LANG guard via the real matcher', () => {
  const book = {
    id: 'bk-yoga',
    title: 'Yoga Sutras',
    author: 'Patanjali',
    language: 'Sanskrit',
    original_language: 'Sanskrit',
  };

  /** A complete prior translation that should defeat a first-translation claim. */
  const row = (sourceLanguage: string) => ({
    _id: 'row-1',
    source: 'claude_subagent_verify',
    author: 'Patanjali',
    canonical_author: 'Patanjali',
    author_surname: 'patanjali',
    english_title: 'Yoga Sutras',
    translator: 'Charles Johnston',
    pub_year: '1912',
    pub_year_int: 1912,
    completeness: 'complete',
    source_language: sourceLanguage,
  });

  it('passes when the row carries an ISO code', () => {
    const result = matchBookToCatalog(book, buildCatalogIndex([row('sa')]));
    expect(result).not.toBeNull();
    expect(result.best_match.guards.SOURCE_LANG.pass).toBe(true);
  });

  it('ALSO passes when the row carries the display name — the #3460 regression', () => {
    // Before the fix this compared 'sa' against 'sanskrit' and failed, taking
    // the whole hand-verified batch out of play.
    const result = matchBookToCatalog(book, buildCatalogIndex([row('Sanskrit')]));
    expect(result).not.toBeNull();
    expect(result.best_match.guards.SOURCE_LANG.pass).toBe(true);
  });

  it('still rejects a genuinely different source language', () => {
    // The guard must keep doing its job: a Latin→English translation does not
    // defeat a Sanskrit→English first claim.
    const result = matchBookToCatalog(book, buildCatalogIndex([row('Latin')]));
    expect(result).not.toBeNull();
    expect(result.best_match.guards.SOURCE_LANG.pass).toBe(false);
  });

  it('a display-name row with completeness=complete becomes a demote candidate', () => {
    // The end-to-end consequence: all five guards pass, so the row is finally
    // able to surface an over-claim.
    const result = matchBookToCatalog(book, buildCatalogIndex([row('Sanskrit')]));
    expect(result.best_match.all_guards_pass).toBe(true);
    expect(result.tier).toBe('demote_candidate');
  });
});
