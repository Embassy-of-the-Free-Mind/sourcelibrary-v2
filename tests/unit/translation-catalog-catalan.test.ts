/**
 * Catalan in the catalog-record source-language vocabulary (#3460 follow-up).
 *
 * Found the honest way: a REAL verified prior was quarantined for it. McKenny
 * 2024 translates Ramon Llull's *Llibre de contemplació en Déu* from the
 * Catalan, and the ingest refused the row because `ca` was absent from a list
 * that already held `es`, `fr`, `it`, `nl` and `de`. Llull is a major author in
 * this corpus, so that was an oversight rather than a judgement.
 *
 * Worth recording HOW it surfaced: the guard quarantines an unmappable
 * source_language — keeping the row and the reason — instead of dropping it or
 * silently coercing it. A guard that failed closed by discarding would have lost
 * a verified prior and left no trace to notice. The reason string is what made
 * the gap visible.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import { buildCatalogDoc } from '../../scripts/lib/translation-catalog-record.mjs';

describe('Catalan is an accepted source language', () => {
  it('accepts the case that was quarantined', () => {
    const doc = buildCatalogDoc({
      english_title: "Ramon Llull's Book of Contemplation in God (Book I, Prologue-Chapter 29)",
      translator: 'Mihow P. McKenny',
      pub_year: '2024',
      source_language: 'Catalan',
      completeness: 'partial',
      source: 'claude_subagent_verify',
    });
    expect(doc.source_language).toBe('ca');
  });

  it('accepts the ISO code and the Valencian variant name', () => {
    for (const v of ['ca', 'catalan', 'Valencian']) {
      const doc = buildCatalogDoc({
        english_title: 'X',
        translator: 'A B',
        pub_year: '2000',
        source_language: v,
        completeness: 'complete',
        source: 'claude_subagent_verify',
      });
      expect(doc.source_language, v).toBe('ca');
    }
  });

  it('still THROWS on a genuinely unmappable language, so the quarantine keeps working', () => {
    // The point of the change is one missing entry, not a looser guard. An
    // unrecognised value must still fail loudly enough to be quarantined with a
    // reason — that behaviour is what surfaced Catalan in the first place.
    expect(() => buildCatalogDoc({
      english_title: 'X',
      translator: 'A B',
      pub_year: '2000',
      source_language: 'Klingon',
      completeness: 'complete',
      source: 'claude_subagent_verify',
    })).toThrow(/invalid source_language/i);
  });
});
