import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANE_FILTER_PARAMS,
  LANE_ROUTE,
  LANE_SORT,
  completeYear,
  laneHonours,
  searchLane,
  type SearchLane,
} from '@/lib/search-filter-support';

// /search shows a filter control only where LANE_FILTER_PARAMS says the lane
// takes it (#3401). The table is only worth that trust if it cannot drift
// ahead of the routes: a filter listed here that the route never reads is a
// control that lights up and changes nothing — the bug the table exists to
// prevent. So each claim is checked against the route's own source.

const root = join(__dirname, '..', '..');
const routeSource = (lane: SearchLane) => readFileSync(join(root, LANE_ROUTE[lane]), 'utf8');
const reads = (source: string, param: string) => source.includes(`searchParams.get('${param}')`);

describe('search lane filter table', () => {
  for (const lane of Object.keys(LANE_FILTER_PARAMS) as SearchLane[]) {
    it(`${lane}: every filter it claims is read by ${LANE_ROUTE[lane]}`, () => {
      const source = routeSource(lane);
      for (const [filter, params] of Object.entries(LANE_FILTER_PARAMS[lane])) {
        for (const param of params) {
          expect(reads(source, param), `${lane} claims "${filter}" but the route never reads ?${param}=`).toBe(true);
        }
      }
    });
  }

  // Positive control for the check above: the four dead controls measured on
  // production (2026-10-13) must read as dead here too. If one of these starts
  // failing, the route has learned the filter — add it to the table and the
  // control comes back.
  it('the route check can tell a missing filter from a present one', () => {
    expect(reads(routeSource('unified'), 'collection')).toBe(false);
    expect(reads(routeSource('books'), 'collection')).toBe(false);
    expect(reads(routeSource('unified'), 'has_doi')).toBe(false);
    expect(reads(routeSource('browse-books'), 'date_from')).toBe(false);
    expect(reads(routeSource('books'), 'has_doi')).toBe(true);
  });

  it('does not offer the dead controls', () => {
    expect(laneHonours('unified', 'collection')).toBe(false);
    expect(laneHonours('books', 'collection')).toBe(false);
    expect(laneHonours('unified', 'hasDoi')).toBe(false);
    expect(laneHonours('browse-books', 'dates')).toBe(false);
    expect(laneHonours('browse-books', 'hasDoi')).toBe(false);
    expect(laneHonours('index', 'language')).toBe(false);
    expect(laneHonours('images', 'category')).toBe(false);
  });

  it('keeps the controls that work', () => {
    expect(laneHonours('browse-books', 'collection')).toBe(true);
    expect(laneHonours('books', 'hasDoi')).toBe(true);
    expect(laneHonours('unified', 'dates')).toBe(true);
    expect(laneHonours('index', 'dates')).toBe(true);
    expect(laneHonours('browse-images', 'dates')).toBe(true);
  });

  it('every lane keeps at least one filter, so the Filters toggle is never an empty panel', () => {
    for (const lane of Object.keys(LANE_FILTER_PARAMS) as SearchLane[]) {
      expect(Object.keys(LANE_FILTER_PARAMS[lane]).length).toBeGreaterThan(0);
    }
  });

  it('offers a sort dropdown only where the request carries one', () => {
    expect(LANE_SORT.books).toBe('search');
    expect(LANE_SORT['browse-books']).toBe('browse');
    expect(LANE_SORT.unified).toBeNull();
    expect(LANE_SORT.index).toBeNull();
    expect(LANE_SORT.images).toBeNull();
    expect(LANE_SORT['browse-images']).toBeNull();
  });
});

describe('searchLane', () => {
  it('maps browse mode to the two browse lanes', () => {
    expect(searchLane(true, 'unified')).toBe('browse-books');
    expect(searchLane(true, 'books')).toBe('browse-books');
    expect(searchLane(true, 'images')).toBe('browse-images');
  });

  it('maps a query to the tab being shown', () => {
    expect(searchLane(false, 'unified')).toBe('unified');
    expect(searchLane(false, 'books')).toBe('books');
    expect(searchLane(false, 'index')).toBe('index');
    expect(searchLane(false, 'images')).toBe('images');
  });
});

describe('completeYear', () => {
  it('waits for a whole year', () => {
    expect(completeYear('')).toBeUndefined();
    expect(completeYear('1')).toBeUndefined();
    expect(completeYear('17')).toBeUndefined();
    expect(completeYear('170')).toBe(170);
    expect(completeYear(' 1700 ')).toBe(1700);
  });

  it('refuses anything that is not a year', () => {
    expect(completeYear('circa 1600')).toBeUndefined();
    expect(completeYear('17000')).toBeUndefined();
    expect(completeYear('-500')).toBeUndefined();
  });
});
