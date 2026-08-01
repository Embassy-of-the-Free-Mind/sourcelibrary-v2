/**
 * `publishedToYear` — the numeric `year` that date range-filters read (#3267).
 *
 * `books.published` is free text, so it can never be range-compared; `year` is
 * the filterable twin, and an import that omits it makes the book invisible to
 * every date filter in search. Only 2 of 24 import routes set it before this
 * change, and both used `/^\d{3,4}$/` against the whole string — which rejects
 * every real-world early-modern imprint form below.
 *
 * These are BEHAVIOUR assertions: each case is an input the old expression got
 * wrong (or a value we must refuse to invent). A source-shape test would have
 * passed against the broken version.
 */
import { describe, it, expect } from 'vitest';
import { publishedToYear } from '../../src/lib/resolve-language';

describe('publishedToYear', () => {
  it('reads a bare year', () => {
    expect(publishedToYear('1628')).toBe(1628);
  });

  it('reads the free-text imprint forms the old regex rejected', () => {
    // Every one of these returned null under /^\d{3,4}$/.test(published).
    expect(publishedToYear('circa 1600')).toBe(1600);
    expect(publishedToYear('[1620]')).toBe(1620);
    expect(publishedToYear('1628.')).toBe(1628);
    expect(publishedToYear('M.DC.XXVIII [1628]')).toBe(1628);
    expect(publishedToYear('1628-1630')).toBe(1628);
    expect(publishedToYear(' 1543 ')).toBe(1543);
  });

  it('accepts a caller-supplied number', () => {
    expect(publishedToYear(1628)).toBe(1628);
  });

  it('handles three-digit and negative (BCE) years', () => {
    expect(publishedToYear('987')).toBe(987);
    expect(publishedToYear('-350')).toBe(-350);
  });

  it('refuses to invent a year rather than guessing wrong', () => {
    // An absent year reads as "unknown"; a wrong one silently misfiles the book
    // into another century's filter results.
    expect(publishedToYear('n.d.')).toBeNull();
    expect(publishedToYear('Unknown')).toBeNull();
    expect(publishedToYear('unknown')).toBeNull();
    expect(publishedToYear('MDCXXVIII')).toBeNull(); // roman only, no digits
    expect(publishedToYear('')).toBeNull();
    expect(publishedToYear(null)).toBeNull();
    expect(publishedToYear(undefined)).toBeNull();
  });

  it('rejects implausible years', () => {
    expect(publishedToYear('9999')).toBeNull();
    expect(publishedToYear(String(new Date().getFullYear() + 5))).toBeNull();
  });

  it('never returns NaN — a NaN year would poison every range comparison', () => {
    for (const v of ['n.d.', 'Unknown', '', 'MDCXXVIII', null, undefined]) {
      const y = publishedToYear(v as string | null | undefined);
      expect(y === null || Number.isFinite(y)).toBe(true);
    }
  });
});
