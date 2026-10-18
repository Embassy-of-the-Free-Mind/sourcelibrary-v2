import { describe, it, expect } from 'vitest';
import {
  centuryLabel, centuryOf, centuryRange, centurySlug, parseCenturySlug, parseWorkPeriodValue,
  parseWorkYear, workDateBasis, workPeriodLabel, workPeriodOptions, workPeriodValue, workYearMatch,
} from '@/lib/work-dates';

describe('century of a work year (#6873)', () => {
  it('counts CE centuries from year 1', () => {
    expect(centuryOf(1)).toBe(1);
    expect(centuryOf(100)).toBe(1);
    expect(centuryOf(101)).toBe(2);
    expect(centuryOf(250)).toBe(3);
    expect(centuryOf(1600)).toBe(16);
    expect(centuryOf(1601)).toBe(17);
  });

  it('counts BCE centuries backwards, with year 0 in the 1st century BCE', () => {
    expect(centuryOf(-1)).toBe(-1);
    expect(centuryOf(0)).toBe(-1);
    expect(centuryOf(-100)).toBe(-1);
    expect(centuryOf(-101)).toBe(-2);
    expect(centuryOf(-442)).toBe(-5);
    expect(centuryOf(-2037)).toBe(-21);
  });

  it('every year falls inside the range of its own century', () => {
    for (let y = -3000; y <= 2050; y += 7) {
      const { from, to } = centuryRange(centuryOf(y));
      expect(y >= from && y <= to, `year ${y}`).toBe(true);
    }
    // and the ranges tile: no gap and no overlap between neighbours
    expect(centuryRange(-1)).toEqual({ from: -100, to: 0 });
    expect(centuryRange(1)).toEqual({ from: 1, to: 100 });
    expect(centuryRange(-2)).toEqual({ from: -200, to: -101 });
  });

  it('labels and slugs round-trip', () => {
    expect(centuryLabel(3)).toBe('3rd century');
    expect(centuryLabel(-5)).toBe('5th century BCE');
    expect(centuryLabel(11)).toBe('11th century');
    expect(centuryLabel(21)).toBe('21st century');
    expect(centuryLabel(16, 'es')).toBe('siglo XVI');
    expect(centuryLabel(-4, 'es')).toBe('siglo IV a. C.');
    for (const c of [-30, -5, -1, 1, 2, 3, 11, 12, 13, 21, 22]) {
      expect(parseCenturySlug(centurySlug(c))).toBe(c);
    }
    expect(parseCenturySlug('3th-century')).toBeNull();
    expect(parseCenturySlug('0th-century')).toBeNull();
    expect(parseCenturySlug('timeline')).toBeNull();
  });
});

describe('work-year filter values', () => {
  it('takes any whole year as given, so an empty range answers 0 rather than everything', () => {
    expect(parseWorkYear('1600')).toBe(1600);
    expect(parseWorkYear('-400')).toBe(-400);
    expect(parseWorkYear('3000')).toBe(3000);
    expect(parseWorkYear('16a0')).toBeNull();
    expect(parseWorkYear('')).toBeNull();
    expect(parseWorkYear(null)).toBeNull();
  });

  it('builds a numeric range predicate on the indexed work year', () => {
    expect(workYearMatch(null, null)).toBeNull();
    expect(workYearMatch(201, 300)).toEqual({ 'source_work_dates_meta.work.year': { $type: 'number', $gte: 201, $lte: 300 } });
    expect(workYearMatch(null, 499)).toEqual({ 'source_work_dates_meta.work.year': { $type: 'number', $lte: 499 } });
  });

  it('every select option survives the URL round trip', () => {
    for (const o of workPeriodOptions()) {
      const { from, to } = parseWorkPeriodValue(o.value);
      expect({ from, to }).toEqual({ from: o.from, to: o.to });
      expect(workPeriodValue(from, to)).toBe(o.value);
      expect(workPeriodLabel(from, to)).toBe(o.label);
    }
    expect(workPeriodLabel(1450, 1460)).toBe('1450 to 1460');
  });

  it('offers "before 500 CE" for the question readers ask in those words', () => {
    const o = workPeriodOptions().find((x) => x.label === 'Before 500 CE');
    expect(o).toMatchObject({ from: null, to: 499 });
  });
});

describe('what a work date rests on', () => {
  it('marks record-based bases sourced and the model estimate estimated', () => {
    for (const basis of ['wikidata', 'author_lifespan', 'colophon', 'title_page', 'catalogue'] as const) {
      expect(workDateBasis({ basis }).sourced).toBe(true);
    }
    expect(workDateBasis({ basis: 'model_knowledge', why: 'Preface dated 1082' })).toEqual({
      sourced: false, tag: 'Estimated', note: 'Why this date: Preface dated 1082',
    });
  });

  it('withholds a reason that disputes its own date, as the book page does', () => {
    expect(workDateBasis({ basis: 'model_knowledge', why: 'x' }, ['why_disagrees']).note).toBeNull();
  });
});
