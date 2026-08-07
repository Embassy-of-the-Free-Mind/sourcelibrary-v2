import { describe, it, expect } from 'vitest';
import { formatYear, formatYearSpan } from '@/lib/format-year';

describe('formatYear', () => {
  it('prints CE years bare', () => {
    expect(formatYear(1524)).toBe('1524');
    expect(formatYear(550)).toBe('550');
  });

  it('labels BCE years rather than printing a minus sign', () => {
    expect(formatYear(-1550)).toBe('1550 BCE');
    expect(formatYear(-664)).toBe('664 BCE');
  });
});

describe('formatYearSpan', () => {
  // The regression this exists for: /work/[id] read the span off
  // `parseInt(published)`, so "12th century" became the year 12 and Boethius —
  // 31 witnesses, 1150 to 1900 — advertised itself as "12 – 1900". The Four
  // Gospels rendered "18 – 1100" against a real span of 550–1750.
  it('renders a real span', () => {
    expect(formatYearSpan(1150, 1900)).toBe('1150 – 1900');
    expect(formatYearSpan(550, 1750)).toBe('550 – 1750');
  });

  it('collapses a single-year span to one label', () => {
    expect(formatYearSpan(1621, 1621)).toBe('1621');
  });

  it('spans the BCE/CE boundary', () => {
    expect(formatYearSpan(-712, 100)).toBe('712 BCE – 100');
  });

  it('returns null when there is nothing datable, so callers omit the element', () => {
    expect(formatYearSpan(null, 1900)).toBeNull();
    expect(formatYearSpan(null, null)).toBeNull();
  });
});
