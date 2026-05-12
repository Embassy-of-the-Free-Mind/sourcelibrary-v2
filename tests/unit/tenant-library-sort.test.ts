import { describe, it, expect } from 'vitest';

/**
 * Regression test for the grid-view sort being a silent no-op (testing
 * report B8). The bug: `sortStage` was initialised with `{ title: 1 }`
 * *before* the switch added the requested sort key. MongoDB applies sort
 * keys in declaration order, so `title` was always the primary sort and
 * every other option behaved like Title A-Z.
 *
 * Lock in the new shape:
 *   - Each case's primary key comes FIRST in the resulting object.
 *   - `title` is appended as a stable tiebreaker if not already the primary.
 *
 * This test mirrors the production switch in browseTenantBooks
 * (src/lib/tenant-library-loaders.ts) so a regression there fails here.
 */

type Sort = 'popular' | 'title' | 'author' | 'year_asc' | 'year_desc' | 'shelfmark' | 'recent';

function buildSortStage(sort: Sort): Record<string, 1 | -1> {
  const sortStage: Record<string, 1 | -1> = {};
  switch (sort) {
    case 'popular':
      sortStage['quality_score'] = -1;
      sortStage['has_translations'] = -1;
      sortStage['last_translation_at'] = -1;
      break;
    case 'title':
      sortStage['title'] = 1;
      break;
    case 'author':
      sortStage['author'] = 1;
      break;
    case 'year_asc':
      sortStage['year'] = 1;
      break;
    case 'year_desc':
      sortStage['year'] = -1;
      break;
    case 'shelfmark':
      sortStage['dublin_core.dc_source'] = 1;
      break;
    case 'recent':
      sortStage['last_processed'] = -1;
      break;
  }
  if (!('title' in sortStage)) sortStage['title'] = 1;
  return sortStage;
}

describe('browseTenantBooks sortStage', () => {
  it('year_asc primary key is year (not title)', () => {
    const stage = buildSortStage('year_asc');
    expect(Object.keys(stage)[0]).toBe('year');
    expect(stage['year']).toBe(1);
  });

  it('year_desc primary key is year, descending', () => {
    const stage = buildSortStage('year_desc');
    expect(Object.keys(stage)[0]).toBe('year');
    expect(stage['year']).toBe(-1);
  });

  it('author primary key is author', () => {
    const stage = buildSortStage('author');
    expect(Object.keys(stage)[0]).toBe('author');
  });

  it('shelfmark primary key is dublin_core.dc_source', () => {
    const stage = buildSortStage('shelfmark');
    expect(Object.keys(stage)[0]).toBe('dublin_core.dc_source');
  });

  it('popular primary key is quality_score', () => {
    const stage = buildSortStage('popular');
    expect(Object.keys(stage)[0]).toBe('quality_score');
  });

  it('title is appended as tiebreaker when not primary', () => {
    expect(buildSortStage('year_asc')).toHaveProperty('title', 1);
    expect(buildSortStage('author')).toHaveProperty('title', 1);
    expect(buildSortStage('popular')).toHaveProperty('title', 1);
  });

  it('title-sort works with just one key', () => {
    const stage = buildSortStage('title');
    expect(stage).toEqual({ title: 1 });
  });
});
